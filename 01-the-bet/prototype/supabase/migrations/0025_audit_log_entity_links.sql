-- Lets a real audit_log row carry a direct pointer to the specific
-- agent or approval it's about, so the Audit Trail can link an actor
-- name back to its Agent Registry row, or an action back to its
-- Approval Queue item — the same deep-link convention already shipped
-- for agents.html/approvals.html/workflow-history.html.
--
-- Plain nullable text columns, no foreign key — same choice already
-- made for orchestrate_runs.approval_id/release_approval_id (both
-- agents and approvals have composite (id, workspace_id) primary
-- keys, so a real FK here would need to be composite too; the app
-- already trusts these references without DB-enforced constraints
-- elsewhere, and the Audit Trail UI falls back to plain, unlinked text
-- whenever the id doesn't resolve to a row still in the current
-- state — same "honest gap, not a fabricated backfill" as every other
-- best-effort cross-link in this app). Only set going forward, by the
-- specific call sites that are genuinely about one agent or one
-- approval — system/workspace-level entries (redaction, prompt-
-- injection screening, data retention, emergency stop) intentionally
-- leave both null.
alter table public.audit_log
  add column agent_id text,
  add column approval_id text;

create index audit_log_agent_id_idx on public.audit_log (workspace_id, agent_id) where agent_id is not null;
create index audit_log_approval_id_idx on public.audit_log (workspace_id, approval_id) where approval_id is not null;
