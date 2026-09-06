-- Aiven Orchestrator — governance platform schema (Horizon 1)
-- Mirrors the shape of the prototype's former localStorage store
-- (assets/data.js) so the frontend swap was a data-layer change, not a
-- UI rewrite. No auth yet (Horizon 2 per the roadmap) — RLS is ON with
-- permissive anon policies, a known tradeoff documented in
-- 01-the-bet/prototype.md.

create table public.agents (
  id text primary key,
  name text not null,
  dept text not null,
  tier text not null check (tier in ('Core', 'Leader', 'Filler', 'Killer')),
  model text not null,
  status text not null check (status in ('Active', 'Paused', 'Review')),
  can text not null,
  cannot text not null,
  approval text not null,
  reviewed date not null,
  updated_at timestamptz not null default now()
);

create table public.policies (
  id text primary key,
  tier text not null,
  label text not null,
  autonomy text not null check (autonomy in ('Autonomous', 'Advisory', 'Approval-required', 'Two-gate')),
  risk_threshold int not null check (risk_threshold between 0 and 100),
  escalation text not null,
  updated_at timestamptz not null default now()
);

create table public.approvals (
  id text primary key,
  title text not null,
  agent text not null,
  dept text not null,
  risk text not null check (risk in ('Low', 'Medium', 'High')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);

create table public.shadow_tools (
  id text primary key,
  name text not null,
  owner text not null,
  risk text not null check (risk in ('Low', 'Medium', 'High')),
  decision text not null default 'undecided' check (decision in ('undecided', 'govern', 'kill')),
  note text not null,
  found_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  actor text not null,
  action text not null,
  model text,
  risk text,
  detail text
);

create index audit_log_ts_idx on public.audit_log (ts desc);

-- RLS: on, permissive (no auth in this pass — see docs for the tradeoff)
alter table public.agents enable row level security;
alter table public.policies enable row level security;
alter table public.approvals enable row level security;
alter table public.shadow_tools enable row level security;
alter table public.audit_log enable row level security;

create policy "anon full access" on public.agents for all using (true) with check (true);
create policy "anon full access" on public.policies for all using (true) with check (true);
create policy "anon full access" on public.approvals for all using (true) with check (true);
create policy "anon full access" on public.shadow_tools for all using (true) with check (true);
create policy "anon read+insert" on public.audit_log for select using (true);
create policy "anon insert" on public.audit_log for insert with check (true);

-- Seed data — matches the prototype's original seeded state
insert into public.agents (id, name, dept, tier, model, status, can, cannot, approval, reviewed) values
  ('research', 'Research & Data Agent', 'Operations', 'Core', 'Claude Sonnet 5', 'Active',
   'Pulls and reconciles data across connected systems', 'Cannot write to source systems or contact external parties',
   'None — advisory only', '2026-08-14'),
  ('finance', 'Finance Agent', 'Finance', 'Core', 'GPT-4o', 'Active',
   'Analyzes cost structure, margin, and variance', 'Cannot alter financial records or authorize spend',
   'None — advisory only', '2026-08-14'),
  ('ops', 'Operations Agent', 'Operations', 'Core', 'Claude Sonnet 5', 'Active',
   'Maps process cycle times and bottlenecks', 'Cannot modify workflow configuration',
   'None — advisory only', '2026-08-11'),
  ('strategy', 'Strategy Agent', 'Executive', 'Core', 'GPT-4o', 'Active',
   'Synthesizes findings into prioritized recommendations', 'Cannot publish externally without Writer + Compliance sign-off',
   'None — advisory only', '2026-08-11'),
  ('writer', 'Executive Writer Agent', 'Executive', 'Core', 'Claude Sonnet 5', 'Active',
   'Drafts governed executive deliverables', 'Cannot distribute outside the reviewing workspace',
   'Human sign-off before external distribution', '2026-08-11'),
  ('scanning', 'Scanning Agent', 'Fraud Ops', 'Leader', 'Claude Haiku 4.5', 'Active',
   'Scores every transaction for scam likelihood, applies flags', 'Cannot contact customers, generate documents, or act beyond scoring',
   'None — fully autonomous, advisory score only', '2026-08-20'),
  ('context', 'Context Agent', 'Fraud Ops', 'Filler', 'Claude Sonnet 5', 'Active',
   'Pulls related account/merchant history, drafts a contextual summary', 'Cannot alter the risk score, start a dispute, or send anything externally',
   'None to generate — output advisory-only for the analyst', '2026-08-20'),
  ('dispute', 'Dispute Agent', 'Fraud Ops', 'Killer', 'Claude Opus 4.8', 'Review',
   'Drafts a dispute-letter template once triggered', 'Cannot generate without a trigger, or send without a second confirmation',
   'Explicit analyst approval to generate, separate approval to send', '2026-08-22'),
  ('compliance', 'Compliance / Audit Agent', 'Risk & Compliance', 'Core', 'Claude Opus 4.8', 'Active',
   'Logs every action to the audit trail, monitors drift/hallucination, flags overrides', 'Cannot override an analyst decision or block an action unilaterally',
   'N/A — flags, never decides', '2026-08-22');

insert into public.policies (id, tier, label, autonomy, risk_threshold, escalation) values
  ('leader', 'Leader', 'Leader tier — Scanning', 'Autonomous', 62,
   'Auto-escalate to Filler tier + analyst approval queue when a transaction''s score crosses the threshold.'),
  ('filler', 'Filler', 'Filler tier — Context', 'Advisory', 75,
   'Generates automatically; advisory-only for the analyst. An analyst override of a High flag routes to a second reviewer.'),
  ('killer', 'Killer', 'Killer tier — Dispute', 'Two-gate', 90,
   'Requires an explicit analyst approval to generate, and a separate explicit approval to send. Never a single-click autonomous action.'),
  ('compliance', 'Core', 'Cross-cutting — Compliance/Audit', 'Advisory', 50,
   'Any Reliability Contract alert threshold breach (hallucination rate, drift velocity, accuracy) routes to the compliance/audit owner, not just the analyst queue.');

insert into public.approvals (id, title, agent, dept, risk, requested_at) values
  ('ap1', 'Publish Q3 Vendor Risk Review to Legal workspace', 'Risk & Compliance Agent', 'Operations', 'Medium', now() - interval '6 hours'),
  ('ap2', 'Grant Finance Agent read access to Q4 forecast model', 'Orchestrator Core', 'Finance', 'Low', now() - interval '1 day'),
  ('ap3', 'Generate dispute-letter template for txn #48213 (gate 1 of 2)', 'Dispute Agent', 'Fraud Ops', 'High', now() - interval '38 minutes'),
  ('ap4', 'Send approved dispute letter to cardholder for txn #47950 (gate 2 of 2)', 'Dispute Agent', 'Fraud Ops', 'High', now() - interval '2 hours'),
  ('ap5', 'Reverse High-risk flag on txn #48007 per analyst override', 'Compliance / Audit Agent', 'Fraud Ops', 'Medium', now() - interval '4 hours');

insert into public.shadow_tools (id, name, owner, risk, decision, note) values
  ('sh1', 'Personal ChatGPT accounts used by analysts to draft dispute letters by hand', 'Fraud Ops (unmanaged)', 'High', 'kill',
   'Replaced by the governed Dispute Agent flow — real customer PII was being pasted into an ungoverned consumer tool.'),
  ('sh2', 'Legacy rules-based fraud scoring vendor (pre-Orchestrator)', 'Fraud Ops', 'Medium', 'govern',
   'Kept running in parallel during rollout as a fallback/comparison baseline; brought under the same audit logging.'),
  ('sh3', 'Spreadsheet macro analysts use to track prior disputes manually', 'Individual analysts (informal)', 'Low', 'govern',
   'Migrating what it holds into the golden dataset / Network Intelligence loop instead of leaving it siloed on someone''s laptop.');

insert into public.audit_log (ts, actor, action, model, risk, detail) values
  (now() - interval '2 minutes', 'Compliance / Audit Agent', 'Flagged reliability alert — Filler-tier drift 4.2% vs. golden-dataset baseline', 'Claude Opus 4.8', 'Medium', 'Within tolerance, routed to compliance/audit owner for review.'),
  (now() - interval '20 minutes', 'Dispute Agent', 'Drafted dispute-letter template for txn #48213', 'Claude Opus 4.8', 'High', 'Pending gate 1 of 2 analyst approval before generation is finalized.'),
  (now() - interval '55 minutes', 'Scanning Agent', 'Scored transaction #48210 — scam likelihood 0.31', 'Claude Haiku 4.5', 'Low', 'Below escalation threshold; no human action required.'),
  (now() - interval '90 minutes', 'Scanning Agent', 'Scored transaction #48207 — scam likelihood 0.74', 'Claude Haiku 4.5', 'High', 'Crossed risk threshold — auto-escalated to Filler tier.'),
  (now() - interval '94 minutes', 'Context Agent', 'Drafted contextual summary for txn #48207', 'Claude Sonnet 5', 'High', 'Landed in the analyst approval queue for review.'),
  (now() - interval '150 minutes', 'Human reviewer', 'Approved redaction & inclusion policy for Q3 Vendor Risk Review', null, null, 'Gate cleared; deliverable released to the executive workspace.'),
  (now() - interval '210 minutes', 'Orchestrator Core', 'Reassigned Finance Agent from Claude Sonnet 5 to GPT-4o', 'GPT-4o', null, 'Governance policy re-evaluated automatically after model swap.'),
  (now() - interval '260 minutes', 'Compliance / Audit Agent', 'Killed shadow AI tool: personal ChatGPT use by Fraud Ops analysts', null, 'High', 'Real customer PII was being pasted into an ungoverned consumer tool.'),
  (now() - interval '320 minutes', 'Human reviewer', 'Reversed High-risk flag on txn #48001 (analyst override)', null, 'Medium', 'Routed to a second reviewer per escalation policy.'),
  (now() - interval '400 minutes', 'Dispute Agent', 'Sent approved dispute letter to cardholder for txn #47822', 'Claude Opus 4.8', 'High', 'Gate 2 of 2 cleared by a second explicit analyst approval.'),
  (now() - interval '480 minutes', 'Kill-switch drill', 'Verified secondary-provider swap under simulated load', null, null, '34-minute failover — within the <48h Ready target.'),
  (now() - interval '600 minutes', 'Orchestrator Core', 'Weekly reliability sampling completed', null, 'Low', 'Leader-tier accuracy 92.4% — at target. No drift alert raised.');
