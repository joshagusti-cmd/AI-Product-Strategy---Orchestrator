-- Natural-language audit trail Q&A: a real Claude call, grounded
-- strictly in this workspace's own real audit_log rows — "why did the
-- Risk agent flag this?" answered from what's actually in the log, not
-- a canned demo answer. See functions/audit-qa/index.ts.
--
-- audit_qa_log is both the real per-workspace rate limit (same pattern
-- as orchestrate_usage, migrations/0006) and a real, persisted history
-- of every question asked and answered — so, like workflow history
-- (migrations/0013), a past answer is still there after you navigate
-- away, not just shown once and forgotten.
create table public.audit_qa_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  question text not null,
  answer text not null,
  log_rows_considered int not null default 0,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  created_at timestamptz not null default now()
);

create index audit_qa_log_workspace_idx
  on public.audit_qa_log (workspace_id, created_at desc);

alter table public.audit_qa_log enable row level security;

-- Read-only for workspace members; insert-only via the service role
-- key — no anon/authenticated insert policy, same pattern as
-- orchestrate_usage/orchestrate_call_log/orchestrate_runs.
create policy "select own workspace audit qa log" on public.audit_qa_log for select
  using (private.is_workspace_member(workspace_id));
