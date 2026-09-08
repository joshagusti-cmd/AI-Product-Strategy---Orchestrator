-- Workflow history / versioned deliverable archive: a completed
-- Orchestrate run's full deliverable (executive summary, findings,
-- recommendations, risk flags, and every agent step) only ever lived
-- in the browser tab that ran it — nothing persisted it anywhere once
-- you navigated away. orchestrate_runs is a real, append-only archive
-- of every completed run, insert-only via the Edge Function's service
-- role key, same pattern as orchestrate_usage/orchestrate_call_log.
--
-- Distinct from orchestrate_call_log (migrations/0010), which logs one
-- row per *individual agent call* for spend telemetry, and from
-- audit_log, whose one-line "Drafted the executive action plan for…"
-- entry is a pointer, not the deliverable itself. This is the full
-- record: everything workflow-history.html needs to redisplay a past
-- run's deliverable exactly as it looked when it was generated.
create table public.orchestrate_runs (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  objective text not null,
  departments jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  auto_route boolean not null default false,
  routing jsonb,
  steps jsonb not null,
  executive_summary text not null,
  findings jsonb not null,
  recommendations jsonb not null,
  risk_flags jsonb not null,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  substitutions jsonb not null default '[]'::jsonb,
  -- True for a run that paused at the Policy Editor's real gate
  -- (migrations/0011) before completing — approval_id points back to
  -- the approvals row a human decided to let it finish.
  was_paused boolean not null default false,
  approval_id text,
  created_at timestamptz not null default now()
);

create index orchestrate_runs_workspace_idx
  on public.orchestrate_runs (workspace_id, created_at desc);

alter table public.orchestrate_runs enable row level security;

-- Read-only for workspace members; insert-only via the service role
-- key — no anon/authenticated insert policy, same pattern as
-- orchestrate_usage and orchestrate_call_log.
create policy "select own workspace run history" on public.orchestrate_runs for select
  using (private.is_workspace_member(workspace_id));
