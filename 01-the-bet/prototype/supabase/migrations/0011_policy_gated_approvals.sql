-- Wires the Policy Editor to actually gate a real Orchestrate run,
-- instead of the policies table having no consumer anywhere in the app.
--
-- The six Command Center agents (research/finance/ops/risk/strategy/
-- writer) are all tier "Core" in the agents table, so the workspace's
-- Core-tier policy row (id: 'compliance', cross-cutting per
-- 0001/0005's seed) is the one this gates against: when its autonomy is
-- "Approval-required" or "Two-gate" and the Risk & Compliance Agent's
-- real risk flag scores at or above its risk_threshold, the Edge
-- Function now pauses the run for real, before the Strategy/Writer
-- calls (and their real API cost) ever happen — see
-- functions/orchestrate/index.ts.
--
-- A paused run needs somewhere to keep its already-completed steps
-- (research/finance/ops/risk) so the run can actually resume — with the
-- same objective, same routing, same context — once a human approves,
-- rather than starting over. `run_state` holds exactly that; a plain
-- approvals row otherwise has nowhere to carry it. `resumed_at` is an
-- idempotency guard so a paused run can't be completed (and billed)
-- twice.
alter table public.approvals add column run_state jsonb;
alter table public.approvals add column resumed_at timestamptz;

comment on column public.approvals.run_state is
  'Present only on an approval raised by a real Orchestrate run pausing for a policy gate. Holds the objective/routing/steps-so-far needed to resume the run (research/finance/ops/risk already ran; strategy+writer are what''s waiting) once approved. Null for every other approval row.';
comment on column public.approvals.resumed_at is
  'Set once a paused run has actually been resumed and completed, so it cannot be resumed (and its usage/spend double-counted) a second time.';
