-- Teams/invites: lets a workspace member invite a teammate by email
-- instead of every signed-in user only ever getting their own solo
-- workspace. Two acceptance paths, since Supabase auth only fires a
-- signup trigger once, at account creation:
--   1. A brand-new user signs up with an email that has a pending
--      invite — the signup trigger (private.handle_new_user, updated
--      below) joins them to the inviting workspace instead of also
--      creating a fresh solo one.
--   2. An already-registered user gets invited later — they can't
--      re-fire the signup trigger, so the frontend calls the public
--      accept_pending_invites() RPC once per session (see
--      assets/data.js) to pick up anything sent to their email since
--      they last signed up.

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'member',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

-- Fast lookup for "does this email have a pending invite" during signup
-- and on the accept_pending_invites() RPC.
create index workspace_invites_pending_email_idx
  on public.workspace_invites (lower(email))
  where accepted_at is null;

alter table public.workspace_invites enable row level security;

create policy "select own workspace invites" on public.workspace_invites for select
  using (private.is_workspace_member(workspace_id));

-- Anyone already in a workspace can invite a teammate into it (same
-- "every member is effectively an owner" simplification the rest of
-- this schema already has — see supabase/README.md). Never into the
-- shared public demo workspace.
create policy "insert own workspace invites" on public.workspace_invites for insert
  with check (
    private.is_workspace_member(workspace_id)
    and workspace_id <> '00000000-0000-0000-0000-000000000001'
  );

create policy "delete own workspace invites" on public.workspace_invites for delete
  using (private.is_workspace_member(workspace_id));

-- Let a member remove a *different* member from their workspace.
-- Removing yourself ("leave workspace") isn't built yet — the frontend
-- doesn't offer it, and RLS blocks it outright so it can't be done by
-- calling the table directly either.
create policy "delete other workspace members" on public.workspace_members for delete
  using (private.is_workspace_member(workspace_id) and user_id <> auth.uid());

-- Internal helper: joins target_user_id to every workspace that has a
-- pending invite for target_email, marking those invites accepted.
-- Returns how many were accepted. Callers below supply the target
-- explicitly rather than relying on auth.uid() — during the signup
-- trigger there is no session yet to read it from.
create or replace function private.accept_pending_invites_for(target_user_id uuid, target_email text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted_count int;
begin
  if target_user_id is null or target_email is null then
    return 0;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  select wi.workspace_id, target_user_id, wi.role
  from public.workspace_invites wi
  where lower(wi.email) = lower(target_email) and wi.accepted_at is null
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invites
  set accepted_at = now()
  where lower(email) = lower(target_email) and accepted_at is null;

  get diagnostics accepted_count = row_count;
  return accepted_count;
end;
$$;

-- Public RPC (deliberately not moved to the private schema, like
-- reseed_demo_data — the frontend calls this directly): an
-- already-registered user picks up any invite sent to them since they
-- last signed up. Resolves the caller's own id/email from auth.uid()
-- so a user can only ever accept invites addressed to their own
-- verified email.
create or replace function public.accept_pending_invites()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  target_email text;
begin
  select email into target_email from auth.users where id = auth.uid();
  return private.accept_pending_invites_for(auth.uid(), target_email);
end;
$$;

-- Explicitly authenticated-only: Supabase's security advisor flags any
-- security definer function callable by `anon`, and the default grant
-- from `create function` includes PUBLIC (which anon inherits). Revoke
-- that before granting only to authenticated.
revoke execute on function public.accept_pending_invites() from public, anon;
grant execute on function public.accept_pending_invites() to authenticated;

-- Public RPC: lists a workspace's members with their emails (auth.users
-- isn't exposed via PostgREST, so this is the only way the frontend can
-- show "who's on my team"). Checks membership internally before
-- returning anything, so it's safe to call directly with the caller's
-- own token — you can only ever see the roster of a workspace you're
-- already in.
create or replace function public.list_workspace_members(ws uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.is_workspace_member(ws) then
    raise exception 'not a member of this workspace';
  end if;
  return query
    select wm.user_id, u.email::text, wm.role, wm.created_at
    from public.workspace_members wm
    join auth.users u on u.id = wm.user_id
    where wm.workspace_id = ws
    order by wm.created_at asc;
end;
$$;

revoke execute on function public.list_workspace_members(uuid) from public, anon;
grant execute on function public.list_workspace_members(uuid) to authenticated;

-- Updated signup trigger: if the new user has a pending invite, join
-- them to that workspace instead of also creating a redundant solo one.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_ws uuid;
  invited_count int;
begin
  invited_count := private.accept_pending_invites_for(new.id, new.email);
  if invited_count > 0 then
    return new;
  end if;

  insert into public.workspaces (name, owner_user_id, is_demo)
  values (coalesce(new.email, 'My Workspace'), new.id, false)
  returning id into new_ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_ws, new.id, 'owner');

  perform private.seed_workspace_config(new_ws);

  return new;
end;
$$;
