-- Makes the real Command Center pipeline data-driven, reading from the
-- Agent Registry (public.agents) instead of a hardcoded array in the
-- orchestrate Edge Function. Editing the registry now genuinely changes
-- what a real Orchestrate run does — closing the gap where the registry
-- was previously just a label with no real consumer (exactly the kind
-- of drift Shadow AI Audit exists to catch).
--
-- `sequence_order` (not null) marks a row as part of the real pipeline,
-- in that order; `enabled` lets an admin remove one from a run without
-- deleting it; exactly one row must carry `is_writer` (runs last,
-- synthesizes everything) and exactly one `is_risk_gate` (the one whose
-- riskFlag the Core policy actually checks). The existing `can` column
-- is reused as the agent's real prompt-role text — it was already
-- storing that exact sentence for every real pipeline agent, so this
-- is real reuse, not a new redundant field.
alter table public.agents
  add column sequence_order int,
  add column is_writer boolean not null default false,
  add column is_risk_gate boolean not null default false,
  add column enabled boolean not null default true;

-- Defense in depth: at most one writer, one risk-gate, and one agent
-- per sequence position, per workspace — even though the UI won't
-- expose editing these flags yet, a bad manual edit can't silently
-- corrupt the pipeline's structural invariants.
create unique index agents_one_writer_per_workspace on public.agents (workspace_id) where is_writer;
create unique index agents_one_risk_gate_per_workspace on public.agents (workspace_id) where is_risk_gate;
create unique index agents_unique_sequence_per_workspace on public.agents (workspace_id, sequence_order) where sequence_order is not null;

-- Real data fix, every existing workspace: the six real Command Center
-- pipeline agents are research/finance/ops/risk/strategy/writer, in
-- that order. Five of those six ids already existed as registry rows
-- (research/finance/ops/strategy/writer) — mark them as the real
-- pipeline, in order. The sixth, "risk" (the Risk & Compliance Agent
-- whose flag the Core policy gate actually checks), never had a
-- registry row at all — insert it now. This is NOT the same agent as
-- the existing "compliance" row (the Compliance/Audit Agent), which is
-- one of the four illustrative Fraud-Ops case-study agents from the
-- original business narrative (05-the-guardrails/compounding-system.md)
-- and stays exactly as it was, outside the real pipeline.
update public.agents set sequence_order = 1 where id = 'research';
update public.agents set sequence_order = 2 where id = 'finance';
update public.agents set sequence_order = 3 where id = 'ops';
update public.agents set sequence_order = 5 where id = 'strategy';
update public.agents set sequence_order = 6, is_writer = true where id = 'writer';

insert into public.agents (workspace_id, id, name, dept, tier, model, status, can, cannot, approval, reviewed, sequence_order, is_risk_gate)
select id, 'risk', 'Risk & Compliance Agent', 'Risk & Compliance', 'Core', 'Claude Opus 4.8', 'Active',
  'screens findings against governance policy; must flag exactly one realistic governance/compliance risk that would require human approval before anything ships externally',
  'Cannot override a human decision or bypass the policy gate itself — flags only',
  'None to flag; a flag that crosses the Core policy''s threshold pauses the run for human approval',
  current_date, 4, true
from public.workspaces
where not exists (select 1 from public.agents a where a.workspace_id = workspaces.id and a.id = 'risk');

-- Keep new workspaces (real signups, and the demo workspace's reseed)
-- seeding correctly from now on — same six real pipeline agents, same
-- four illustrative Fraud-Ops agents as before, just with the new
-- pipeline columns set from the start instead of needing this same
-- backfill again.
create or replace function private.seed_workspace_config(ws uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  insert into public.agents (workspace_id, id, name, dept, tier, model, status, can, cannot, approval, reviewed, sequence_order, is_writer, is_risk_gate) values
    (ws, 'research', 'Research & Data Agent', 'Operations', 'Core', 'Claude Sonnet 5', 'Active',
     'Pulls and reconciles data across connected systems', 'Cannot write to source systems or contact external parties',
     'None — advisory only', '2026-08-14', 1, false, false),
    (ws, 'finance', 'Finance Agent', 'Finance', 'Core', 'GPT-4o', 'Active',
     'Analyzes cost structure, margin, and variance', 'Cannot alter financial records or authorize spend',
     'None — advisory only', '2026-08-14', 2, false, false),
    (ws, 'ops', 'Operations Agent', 'Operations', 'Core', 'Claude Sonnet 5', 'Active',
     'Maps process cycle times and bottlenecks', 'Cannot modify workflow configuration',
     'None — advisory only', '2026-08-11', 3, false, false),
    (ws, 'risk', 'Risk & Compliance Agent', 'Risk & Compliance', 'Core', 'Claude Opus 4.8', 'Active',
     'screens findings against governance policy; must flag exactly one realistic governance/compliance risk that would require human approval before anything ships externally',
     'Cannot override a human decision or bypass the policy gate itself — flags only',
     'None to flag; a flag that crosses the Core policy''s threshold pauses the run for human approval', current_date, 4, false, true),
    (ws, 'strategy', 'Strategy Agent', 'Executive', 'Core', 'GPT-4o', 'Active',
     'Synthesizes findings into prioritized recommendations', 'Cannot publish externally without Writer + Compliance sign-off',
     'None — advisory only', '2026-08-11', 5, false, false),
    (ws, 'writer', 'Executive Writer Agent', 'Executive', 'Core', 'Claude Sonnet 5', 'Active',
     'Drafts governed executive deliverables', 'Cannot distribute outside the reviewing workspace',
     'Human sign-off before external distribution', '2026-08-11', 6, true, false),
    (ws, 'scanning', 'Scanning Agent', 'Fraud Ops', 'Leader', 'Claude Haiku 4.5', 'Active',
     'Scores every transaction for scam likelihood, applies flags', 'Cannot contact customers, generate documents, or act beyond scoring',
     'None — fully autonomous, advisory score only', '2026-08-20', null, false, false),
    (ws, 'context', 'Context Agent', 'Fraud Ops', 'Filler', 'Claude Sonnet 5', 'Active',
     'Pulls related account/merchant history, drafts a contextual summary', 'Cannot alter the risk score, start a dispute, or send anything externally',
     'None to generate — output advisory-only for the analyst', '2026-08-20', null, false, false),
    (ws, 'dispute', 'Dispute Agent', 'Fraud Ops', 'Killer', 'Claude Opus 4.8', 'Review',
     'Drafts a dispute-letter template once triggered', 'Cannot generate without a trigger, or send without a second confirmation',
     'Explicit analyst approval to generate, separate approval to send', '2026-08-22', null, false, false),
    (ws, 'compliance', 'Compliance / Audit Agent', 'Risk & Compliance', 'Core', 'Claude Opus 4.8', 'Active',
     'Logs every action to the audit trail, monitors drift/hallucination, flags overrides', 'Cannot override an analyst decision or block an action unilaterally',
     'N/A — flags, never decides', '2026-08-22', null, false, false);

  insert into public.policies (workspace_id, id, tier, label, autonomy, risk_threshold, escalation) values
    (ws, 'leader', 'Leader', 'Leader tier — Scanning', 'Autonomous', 62,
     'Auto-escalate to Filler tier + analyst approval queue when a transaction''s score crosses the threshold.'),
    (ws, 'filler', 'Filler', 'Filler tier — Context', 'Advisory', 75,
     'Generates automatically; advisory-only for the analyst. An analyst override of a High flag routes to a second reviewer.'),
    (ws, 'killer', 'Killer', 'Killer tier — Dispute', 'Two-gate', 90,
     'Requires an explicit analyst approval to generate, and a separate explicit approval to send. Never a single-click autonomous action.'),
    (ws, 'compliance', 'Core', 'Cross-cutting — Compliance/Audit', 'Advisory', 50,
     'Any Reliability Contract alert threshold breach (hallucination rate, drift velocity, accuracy) routes to the compliance/audit owner, not just the analyst queue.');
end;
$function$;
