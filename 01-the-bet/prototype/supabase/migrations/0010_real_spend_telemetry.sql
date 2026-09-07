-- Real spend telemetry: one row per individual agent call (up to six
-- per Orchestrate run) with the real model used and real token counts,
-- so the Model Spend Dashboard can show measured cost instead of only
-- the modeled cost-curve numbers. Distinct from orchestrate_usage
-- (migrations/0006), which logs one row per *completed* run purely for
-- the rate-limit check — this logs every individual call, including
-- calls from a run that later fails, since those tokens were still
-- really spent.

create table public.orchestrate_call_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  agent_id text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  called_at timestamptz not null default now()
);

create index orchestrate_call_log_workspace_idx
  on public.orchestrate_call_log (workspace_id, called_at desc);

alter table public.orchestrate_call_log enable row level security;

-- Read-only for workspace members; insert-only via the Edge Function's
-- service role key (bypasses RLS) — no anon/authenticated insert
-- policy, same pattern as orchestrate_usage.
create policy "select own workspace call log" on public.orchestrate_call_log for select
  using (private.is_workspace_member(workspace_id));
