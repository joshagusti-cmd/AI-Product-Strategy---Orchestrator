-- Per-workspace spend cap on Orchestrate (the real, metered Claude call).
-- Auth alone doesn't stop a signed-in user from calling it as often as
-- they like — this adds a rolling 24h cap per workspace, enforced
-- server-side in the orchestrate Edge Function using the service role
-- key (so it can't be bypassed by a client that skips the check).

alter table public.workspaces
  add column daily_orchestrate_limit int not null default 20;

-- Insert-only usage log, one row per successful Orchestrate call. Only
-- the Edge Function (via the service role key, which bypasses RLS)
-- writes to this table — there is deliberately no insert/update/delete
-- policy for anon/authenticated, so a client can't fabricate usage
-- history or erase its own to dodge the cap. Workspace members can
-- still read their own usage, so the frontend can show "X of Y used
-- today" without a round trip through the Edge Function.
create table public.orchestrate_usage (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  called_at timestamptz not null default now()
);

create index orchestrate_usage_workspace_called_idx
  on public.orchestrate_usage (workspace_id, called_at desc);

alter table public.orchestrate_usage enable row level security;

create policy "select own workspace usage" on public.orchestrate_usage for select
  using (private.is_workspace_member(workspace_id));
