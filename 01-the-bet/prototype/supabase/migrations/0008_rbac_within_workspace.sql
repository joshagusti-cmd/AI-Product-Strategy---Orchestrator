-- Real RBAC within a workspace, matching the governance model already
-- described in 05-the-guardrails/compounding-system.md: admin,
-- compliance_owner, analyst. Until now every member (invited or
-- original) could do everything — this closes that gap by making the
-- `role` column on workspace_members/workspace_invites actually mean
-- something at the RLS layer, not just a label the UI showed.

-- Migrate existing values to the new vocabulary before anything below
-- starts checking against it or constraining it.
update public.workspace_members set role = 'admin' where role = 'owner';
update public.workspace_members set role = 'analyst' where role = 'member';
update public.workspace_invites set role = 'admin' where role = 'owner';
update public.workspace_invites set role = 'analyst' where role = 'member';

alter table public.workspace_members alter column role set default 'analyst';
alter table public.workspace_invites alter column role set default 'analyst';

alter table public.workspace_members
  add constraint workspace_members_role_check check (role in ('admin', 'compliance_owner', 'analyst'));
alter table public.workspace_invites
  add constraint workspace_invites_role_check check (role in ('admin', 'compliance_owner', 'analyst'));

-- Internal helper: is the caller an admin of this workspace? Used for
-- team management and agent model reassignment.
create or replace function private.is_workspace_admin(ws uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid() and role = 'admin'
  );
$$;

-- Internal helper: can the caller act as the workspace's compliance
-- owner (admin or compliance_owner)? Used for policy edits and Shadow
-- AI govern/kill decisions — the two surfaces this repo's docs already
-- call "the compliance-owner control surface."
create or replace function private.is_workspace_compliance_owner(ws uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid() and role in ('admin', 'compliance_owner')
  );
$$;

-- Agent model reassignment: admin only.
drop policy "update member only" on public.agents;
create policy "update admin only" on public.agents for update
  using (private.is_workspace_admin(workspace_id)) with check (private.is_workspace_admin(workspace_id));

-- Policy edits: admin or compliance_owner.
drop policy "update member only" on public.policies;
create policy "update compliance owner or admin" on public.policies for update
  using (private.is_workspace_compliance_owner(workspace_id)) with check (private.is_workspace_compliance_owner(workspace_id));

-- Shadow AI govern/kill decisions: admin or compliance_owner. An
-- analyst can still discover and log a new finding (the "Run Shadow AI
-- Scan" action) — that insert policy is unchanged — just not decide
-- one, matching the separation of duties in the Guardrails doc.
drop policy "update member only" on public.shadow_tools;
create policy "update compliance owner or admin" on public.shadow_tools for update
  using (private.is_workspace_compliance_owner(workspace_id)) with check (private.is_workspace_compliance_owner(workspace_id));

-- Team management tightens from "any member" to admin only, now that
-- roles are real: inviting someone (and choosing their role), revoking
-- an invite, and removing a member are all trust decisions.
drop policy "insert own workspace invites" on public.workspace_invites;
create policy "insert admin only" on public.workspace_invites for insert
  with check (
    private.is_workspace_admin(workspace_id)
    and workspace_id <> '00000000-0000-0000-0000-000000000001'
  );

drop policy "delete own workspace invites" on public.workspace_invites;
create policy "delete admin only" on public.workspace_invites for delete
  using (private.is_workspace_admin(workspace_id));

drop policy "delete other workspace members" on public.workspace_members;
create policy "delete other members admin only" on public.workspace_members for delete
  using (private.is_workspace_admin(workspace_id) and user_id <> auth.uid());

-- New: an admin can change a *different* member's role. Not their own
-- — mirrors the existing "can't remove yourself" guard, so an admin
-- can't accidentally demote themselves out of the only admin seat.
create policy "update other member role admin only" on public.workspace_members for update
  using (private.is_workspace_admin(workspace_id) and user_id <> auth.uid())
  with check (private.is_workspace_admin(workspace_id) and user_id <> auth.uid());

-- Updated signup trigger: the auto-created solo workspace's creator is
-- now explicitly an admin (previously "owner", same real meaning, new
-- vocabulary).
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
  values (new_ws, new.id, 'admin');

  perform private.seed_workspace_config(new_ws);

  return new;
end;
$$;
