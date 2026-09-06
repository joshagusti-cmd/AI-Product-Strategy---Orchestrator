create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Workspaces: the demo workspace is public/read-only; every signed-in
-- user gets their own private workspace, auto-created + auto-seeded on
-- first sign-in (see migration 0004's private.handle_new_user()).
-- ---------------------------------------------------------------------
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

insert into public.workspaces (id, name, is_demo) values
  ('00000000-0000-0000-0000-000000000001', 'Demo Workspace', true);

-- Temporary version — replaced by the private-schema version in
-- migration 0004. Defined here so the ALTER TABLE ... PRIMARY KEY steps
-- below and the RLS policies immediately following have something to
-- reference; 0004 supersedes this and drops the public-schema copy.
create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- Add workspace_id to every existing table. agents/policies/approvals/
-- shadow_tools used a bare text `id` as primary key (e.g. 'research',
-- 'ap1') which is only unique *within* a workspace now, so each gets a
-- composite (workspace_id, id) primary key instead.
-- ---------------------------------------------------------------------
alter table public.agents drop constraint agents_pkey;
alter table public.agents add column workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id);
alter table public.agents add primary key (workspace_id, id);

alter table public.policies drop constraint policies_pkey;
alter table public.policies add column workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id);
alter table public.policies add primary key (workspace_id, id);

alter table public.approvals drop constraint approvals_pkey;
alter table public.approvals add column workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id);
alter table public.approvals add primary key (workspace_id, id);

alter table public.shadow_tools drop constraint shadow_tools_pkey;
alter table public.shadow_tools add column workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id);
alter table public.shadow_tools add primary key (workspace_id, id);

alter table public.audit_log add column workspace_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.workspaces(id);
drop index if exists audit_log_ts_idx;
create index audit_log_workspace_ts_idx on public.audit_log (workspace_id, ts desc);

-- ---------------------------------------------------------------------
-- Drop the old wide-open anon policies, replace with: demo workspace is
-- readable by anyone (including anon), but only a workspace's own
-- members can write to it (their own workspace, never the demo one or
-- anyone else's).
-- ---------------------------------------------------------------------
drop policy "anon full access" on public.agents;
drop policy "anon full access" on public.policies;
drop policy "anon full access" on public.approvals;
drop policy "anon full access" on public.shadow_tools;
drop policy "anon read+insert" on public.audit_log;
drop policy "anon insert" on public.audit_log;

alter table public.workspaces enable row level security;
create policy "read demo or own" on public.workspaces for select
  using (is_demo or is_workspace_member(id));

alter table public.workspace_members enable row level security;
create policy "read own membership" on public.workspace_members for select
  using (user_id = auth.uid());

create policy "select demo or member" on public.agents for select using (workspace_id = '00000000-0000-0000-0000-000000000001' or is_workspace_member(workspace_id));
create policy "insert member only" on public.agents for insert with check (is_workspace_member(workspace_id));
create policy "update member only" on public.agents for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy "delete member only" on public.agents for delete using (is_workspace_member(workspace_id));

create policy "select demo or member" on public.policies for select using (workspace_id = '00000000-0000-0000-0000-000000000001' or is_workspace_member(workspace_id));
create policy "insert member only" on public.policies for insert with check (is_workspace_member(workspace_id));
create policy "update member only" on public.policies for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy "delete member only" on public.policies for delete using (is_workspace_member(workspace_id));

create policy "select demo or member" on public.approvals for select using (workspace_id = '00000000-0000-0000-0000-000000000001' or is_workspace_member(workspace_id));
create policy "insert member only" on public.approvals for insert with check (is_workspace_member(workspace_id));
create policy "update member only" on public.approvals for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy "delete member only" on public.approvals for delete using (is_workspace_member(workspace_id));

create policy "select demo or member" on public.shadow_tools for select using (workspace_id = '00000000-0000-0000-0000-000000000001' or is_workspace_member(workspace_id));
create policy "insert member only" on public.shadow_tools for insert with check (is_workspace_member(workspace_id));
create policy "update member only" on public.shadow_tools for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
create policy "delete member only" on public.shadow_tools for delete using (is_workspace_member(workspace_id));

create policy "select demo or member" on public.audit_log for select using (workspace_id = '00000000-0000-0000-0000-000000000001' or is_workspace_member(workspace_id));
create policy "insert member only" on public.audit_log for insert with check (is_workspace_member(workspace_id));
