-- The Supabase security advisor correctly flagged that is_workspace_member,
-- handle_new_user, seed_workspace_config, and seed_demo_activity were
-- directly callable by anyone via the public RPC API (PostgREST
-- auto-exposes every function in the `public` schema). None of these are
-- meant to be called directly — they're internal helpers used by RLS
-- policies, the signup trigger, and reseed_demo_data. Moving them to a
-- `private` schema (which PostgREST does not expose) removes the public
-- RPC surface while RLS policies and triggers can still call them via
-- schema-qualified references.

create schema if not exists private;

create or replace function private.is_workspace_member(ws uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws and user_id = auth.uid()
  );
$$;

create or replace function private.seed_workspace_config(ws uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.agents (workspace_id, id, name, dept, tier, model, status, can, cannot, approval, reviewed) values
    (ws, 'research', 'Research & Data Agent', 'Operations', 'Core', 'Claude Sonnet 5', 'Active',
     'Pulls and reconciles data across connected systems', 'Cannot write to source systems or contact external parties',
     'None — advisory only', '2026-08-14'),
    (ws, 'finance', 'Finance Agent', 'Finance', 'Core', 'GPT-4o', 'Active',
     'Analyzes cost structure, margin, and variance', 'Cannot alter financial records or authorize spend',
     'None — advisory only', '2026-08-14'),
    (ws, 'ops', 'Operations Agent', 'Operations', 'Core', 'Claude Sonnet 5', 'Active',
     'Maps process cycle times and bottlenecks', 'Cannot modify workflow configuration',
     'None — advisory only', '2026-08-11'),
    (ws, 'strategy', 'Strategy Agent', 'Executive', 'Core', 'GPT-4o', 'Active',
     'Synthesizes findings into prioritized recommendations', 'Cannot publish externally without Writer + Compliance sign-off',
     'None — advisory only', '2026-08-11'),
    (ws, 'writer', 'Executive Writer Agent', 'Executive', 'Core', 'Claude Sonnet 5', 'Active',
     'Drafts governed executive deliverables', 'Cannot distribute outside the reviewing workspace',
     'Human sign-off before external distribution', '2026-08-11'),
    (ws, 'scanning', 'Scanning Agent', 'Fraud Ops', 'Leader', 'Claude Haiku 4.5', 'Active',
     'Scores every transaction for scam likelihood, applies flags', 'Cannot contact customers, generate documents, or act beyond scoring',
     'None — fully autonomous, advisory score only', '2026-08-20'),
    (ws, 'context', 'Context Agent', 'Fraud Ops', 'Filler', 'Claude Sonnet 5', 'Active',
     'Pulls related account/merchant history, drafts a contextual summary', 'Cannot alter the risk score, start a dispute, or send anything externally',
     'None to generate — output advisory-only for the analyst', '2026-08-20'),
    (ws, 'dispute', 'Dispute Agent', 'Fraud Ops', 'Killer', 'Claude Opus 4.8', 'Review',
     'Drafts a dispute-letter template once triggered', 'Cannot generate without a trigger, or send without a second confirmation',
     'Explicit analyst approval to generate, separate approval to send', '2026-08-22'),
    (ws, 'compliance', 'Compliance / Audit Agent', 'Risk & Compliance', 'Core', 'Claude Opus 4.8', 'Active',
     'Logs every action to the audit trail, monitors drift/hallucination, flags overrides', 'Cannot override an analyst decision or block an action unilaterally',
     'N/A — flags, never decides', '2026-08-22');

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
$$;

create or replace function private.seed_demo_activity(ws uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.approvals (workspace_id, id, title, agent, dept, risk, requested_at) values
    (ws, 'ap1', 'Publish Q3 Vendor Risk Review to Legal workspace', 'Risk & Compliance Agent', 'Operations', 'Medium', now() - interval '6 hours'),
    (ws, 'ap2', 'Grant Finance Agent read access to Q4 forecast model', 'Orchestrator Core', 'Finance', 'Low', now() - interval '1 day'),
    (ws, 'ap3', 'Generate dispute-letter template for txn #48213 (gate 1 of 2)', 'Dispute Agent', 'Fraud Ops', 'High', now() - interval '38 minutes'),
    (ws, 'ap4', 'Send approved dispute letter to cardholder for txn #47950 (gate 2 of 2)', 'Dispute Agent', 'Fraud Ops', 'High', now() - interval '2 hours'),
    (ws, 'ap5', 'Reverse High-risk flag on txn #48007 per analyst override', 'Compliance / Audit Agent', 'Fraud Ops', 'Medium', now() - interval '4 hours');

  insert into public.shadow_tools (workspace_id, id, name, owner, risk, decision, note) values
    (ws, 'sh1', 'Personal ChatGPT accounts used by analysts to draft dispute letters by hand', 'Fraud Ops (unmanaged)', 'High', 'kill',
     'Replaced by the governed Dispute Agent flow — real customer PII was being pasted into an ungoverned consumer tool.'),
    (ws, 'sh2', 'Legacy rules-based fraud scoring vendor (pre-Orchestrator)', 'Fraud Ops', 'Medium', 'govern',
     'Kept running in parallel during rollout as a fallback/comparison baseline; brought under the same audit logging.'),
    (ws, 'sh3', 'Spreadsheet macro analysts use to track prior disputes manually', 'Individual analysts (informal)', 'Low', 'govern',
     'Migrating what it holds into the golden dataset / Network Intelligence loop instead of leaving it siloed on someone''s laptop.');

  insert into public.audit_log (workspace_id, ts, actor, action, model, risk, detail) values
    (ws, now() - interval '2 minutes', 'Compliance / Audit Agent', 'Flagged reliability alert — Filler-tier drift 4.2% vs. golden-dataset baseline', 'Claude Opus 4.8', 'Medium', 'Within tolerance, routed to compliance/audit owner for review.'),
    (ws, now() - interval '20 minutes', 'Dispute Agent', 'Drafted dispute-letter template for txn #48213', 'Claude Opus 4.8', 'High', 'Pending gate 1 of 2 analyst approval before generation is finalized.'),
    (ws, now() - interval '55 minutes', 'Scanning Agent', 'Scored transaction #48210 — scam likelihood 0.31', 'Claude Haiku 4.5', 'Low', 'Below escalation threshold; no human action required.'),
    (ws, now() - interval '90 minutes', 'Scanning Agent', 'Scored transaction #48207 — scam likelihood 0.74', 'Claude Haiku 4.5', 'High', 'Crossed risk threshold — auto-escalated to Filler tier.'),
    (ws, now() - interval '94 minutes', 'Context Agent', 'Drafted contextual summary for txn #48207', 'Claude Sonnet 5', 'High', 'Landed in the analyst approval queue for review.'),
    (ws, now() - interval '150 minutes', 'Human reviewer', 'Approved redaction & inclusion policy for Q3 Vendor Risk Review', null, null, 'Gate cleared; deliverable released to the executive workspace.'),
    (ws, now() - interval '210 minutes', 'Orchestrator Core', 'Reassigned Finance Agent from Claude Sonnet 5 to GPT-4o', 'GPT-4o', null, 'Governance policy re-evaluated automatically after model swap.'),
    (ws, now() - interval '260 minutes', 'Compliance / Audit Agent', 'Killed shadow AI tool: personal ChatGPT use by Fraud Ops analysts', null, 'High', 'Real customer PII was being pasted into an ungoverned consumer tool.'),
    (ws, now() - interval '320 minutes', 'Human reviewer', 'Reversed High-risk flag on txn #48001 (analyst override)', null, 'Medium', 'Routed to a second reviewer per escalation policy.'),
    (ws, now() - interval '400 minutes', 'Dispute Agent', 'Sent approved dispute letter to cardholder for txn #47822', 'Claude Opus 4.8', 'High', 'Gate 2 of 2 cleared by a second explicit analyst approval.'),
    (ws, now() - interval '480 minutes', 'Kill-switch drill', 'Verified secondary-provider swap under simulated load', null, null, '34-minute failover — within the <48h Ready target.'),
    (ws, now() - interval '600 minutes', 'Orchestrator Core', 'Weekly reliability sampling completed', null, 'Low', 'Leader-tier accuracy 92.4% — at target. No drift alert raised.');
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_ws uuid;
begin
  insert into public.workspaces (name, owner_user_id, is_demo)
  values (coalesce(new.email, 'My Workspace'), new.id, false)
  returning id into new_ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_ws, new.id, 'owner');

  perform private.seed_workspace_config(new_ws);

  return new;
end;
$$;

-- Repoint the trigger and RLS policies at the private-schema versions.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

drop policy "read demo or own" on public.workspaces;
create policy "read demo or own" on public.workspaces for select
  using (is_demo or private.is_workspace_member(id));

drop policy "select demo or member" on public.agents;
drop policy "insert member only" on public.agents;
drop policy "update member only" on public.agents;
drop policy "delete member only" on public.agents;
create policy "select demo or member" on public.agents for select using (workspace_id = '00000000-0000-0000-0000-000000000001' or private.is_workspace_member(workspace_id));
create policy "insert member only" on public.agents for insert with check (private.is_workspace_member(workspace_id));
create policy "update member only" on public.agents for update using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy "delete member only" on public.agents for delete using (private.is_workspace_member(workspace_id));

drop policy "select demo or member" on public.policies;
drop policy "insert member only" on public.policies;
drop policy "update member only" on public.policies;
drop policy "delete member only" on public.policies;
create policy "select demo or member" on public.policies for select using (workspace_id = '00000000-0000-0000-0000-000000000001' or private.is_workspace_member(workspace_id));
create policy "insert member only" on public.policies for insert with check (private.is_workspace_member(workspace_id));
create policy "update member only" on public.policies for update using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy "delete member only" on public.policies for delete using (private.is_workspace_member(workspace_id));

drop policy "select demo or member" on public.approvals;
drop policy "insert member only" on public.approvals;
drop policy "update member only" on public.approvals;
drop policy "delete member only" on public.approvals;
create policy "select demo or member" on public.approvals for select using (workspace_id = '00000000-0000-0000-0000-000000000001' or private.is_workspace_member(workspace_id));
create policy "insert member only" on public.approvals for insert with check (private.is_workspace_member(workspace_id));
create policy "update member only" on public.approvals for update using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy "delete member only" on public.approvals for delete using (private.is_workspace_member(workspace_id));

drop policy "select demo or member" on public.shadow_tools;
drop policy "insert member only" on public.shadow_tools;
drop policy "update member only" on public.shadow_tools;
drop policy "delete member only" on public.shadow_tools;
create policy "select demo or member" on public.shadow_tools for select using (workspace_id = '00000000-0000-0000-0000-000000000001' or private.is_workspace_member(workspace_id));
create policy "insert member only" on public.shadow_tools for insert with check (private.is_workspace_member(workspace_id));
create policy "update member only" on public.shadow_tools for update using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy "delete member only" on public.shadow_tools for delete using (private.is_workspace_member(workspace_id));

drop policy "select demo or member" on public.audit_log;
drop policy "insert member only" on public.audit_log;
create policy "select demo or member" on public.audit_log for select using (workspace_id = '00000000-0000-0000-0000-000000000001' or private.is_workspace_member(workspace_id));
create policy "insert member only" on public.audit_log for insert with check (private.is_workspace_member(workspace_id));

create or replace function public.reseed_demo_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  demo_ws uuid := '00000000-0000-0000-0000-000000000001';
begin
  delete from public.audit_log where workspace_id = demo_ws;
  delete from public.shadow_tools where workspace_id = demo_ws;
  delete from public.approvals where workspace_id = demo_ws;
  delete from public.policies where workspace_id = demo_ws;
  delete from public.agents where workspace_id = demo_ws;

  perform private.seed_workspace_config(demo_ws);
  perform private.seed_demo_activity(demo_ws);
end;
$$;

grant execute on function public.reseed_demo_data() to anon, authenticated;

-- Drop the old public-schema copies now that everything points at the
-- private-schema versions.
drop function if exists public.seed_workspace_config(uuid);
drop function if exists public.seed_demo_activity(uuid);
drop function if exists public.handle_new_user();
drop function if exists public.is_workspace_member(uuid);
