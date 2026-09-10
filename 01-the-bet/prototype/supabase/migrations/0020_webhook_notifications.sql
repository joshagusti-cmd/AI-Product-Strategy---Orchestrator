-- Workspace-configured webhook notifications (feature-ideas.md /
-- backlog.md "Workspace-configured webhook notifications (e.g. on
-- run-paused)"). A plain incoming-webhook URL an admin pastes in — no
-- OAuth app, no new credential Aiven itself has to hold — genuinely
-- buildable unlike the Slack/Teams-native approval-actions row above
-- it. Scope for this pass: fires a real HTTP POST from `orchestrate`
-- the moment a run actually pauses for approval, since that's the
-- one event nobody is otherwise notified of — the Approval Queue has
-- to be manually watched today.

-- One row per workspace: the admin-configured destination. A second
-- table (below) logs every real delivery attempt against it, so
-- "is this thing even working" has a real answer instead of a leap of
-- faith.
create table public.webhook_endpoints (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  url text not null,
  enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.webhook_endpoints enable row level security;

-- Readable by any workspace member (so a non-admin can at least see
-- notifications are configured and where they go), writable by an
-- admin only — same split as agents/policies (migrations/0008): a
-- direct RLS policy gated by private.is_workspace_admin, not a
-- security-definer RPC, since (unlike workspaces.plan/emergency_stop)
-- this is a dedicated table an admin owns outright, not a shared
-- column on a row everyone reads.
create policy "select own workspace webhook config" on public.webhook_endpoints for select
  using (private.is_workspace_member(workspace_id));
create policy "insert admin only" on public.webhook_endpoints for insert
  with check (private.is_workspace_admin(workspace_id));
create policy "update admin only" on public.webhook_endpoints for update
  using (private.is_workspace_admin(workspace_id)) with check (private.is_workspace_admin(workspace_id));
create policy "delete admin only" on public.webhook_endpoints for delete
  using (private.is_workspace_admin(workspace_id));

-- Real delivery log: one row per actual outbound POST attempt, win or
-- lose. Insert-only via the Edge Function's service role key (bypasses
-- RLS) — no anon/authenticated insert policy, same pattern as
-- orchestrate_call_log/agent_events.
create table public.webhook_deliveries (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_type text not null,
  url text not null,
  response_status int,
  success boolean not null,
  error_detail text,
  delivered_at timestamptz not null default now()
);

create index webhook_deliveries_workspace_idx
  on public.webhook_deliveries (workspace_id, delivered_at desc);

alter table public.webhook_deliveries enable row level security;

create policy "select own workspace webhook deliveries" on public.webhook_deliveries for select
  using (private.is_workspace_member(workspace_id));
