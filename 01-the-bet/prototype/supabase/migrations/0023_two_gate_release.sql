-- Real second gate for "Two-gate" autonomy (06-the-pitch/backlog.md's
-- "Ship Killer-tier dispute generator to production (two-gate approval
-- live)" row). Before this, orchestrate/index.ts's shouldPauseForPolicy
-- treated "Approval-required" and "Two-gate" identically — one real
-- pause point before Strategy/Writer run, if risk crosses the
-- threshold. That pause is gate 1: approval to *generate* at all.
--
-- Gate 2 is new: under a "Two-gate" policy specifically, every run that
-- reaches the Executive Writer's final synthesis is recorded but held
-- back from the shared Workflow History archive (released_at null)
-- until a second, separate approval releases it — matching the real
-- "one to generate, one to send" distinction the README's HITL
-- Architecture already describes for the Killer tier. Gate 1 (risk
-- crossing the threshold) still governs *whether an ungoverned
-- deliverable gets generated at all*; gate 2 governs *whether a
-- generated deliverable is distributed*. A workspace on
-- "Approval-required" only ever has gate 1 — once past it, the
-- deliverable is immediately released, unchanged from before.
--
-- The person who ran Orchestrate still sees their own immediate result
-- in the Command Center — gate 2 is about the shared archive other
-- workspace members browse, not about hiding a user's own output from
-- them.

alter table orchestrate_runs
  add column released_at timestamptz,
  add column release_approval_id text;

alter table approvals
  add column release_run_id bigint references orchestrate_runs(id);

-- A run inserted before this migration has release_approval_id null,
-- which the client (and the RPC below) treats as "not gated" — always
-- shown as released. No backfill needed.

-- Decides a release-gate approval — distinct from the plain
-- approvals.status UPDATE any workspace member already does for a
-- risk-gate (gate 1) approval, since a release decision also has to
-- flip the *run's* own released_at atomically, not just the approval
-- row: doing that as two separate client-side writes could leave a
-- run "approved" but never actually marked released if the second
-- write failed. Any workspace member may decide, same as gate 1 —
-- no stricter role than that gate already has.
create or replace function decide_release_approval(p_approval_id text, p_decision text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_run_id bigint;
  v_status text;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision must be approved or rejected';
  end if;

  select workspace_id, release_run_id, status into v_ws, v_run_id, v_status
  from approvals where id = p_approval_id;

  if v_ws is null then
    raise exception 'Approval not found';
  end if;
  if not private.is_workspace_member(v_ws) then
    raise exception 'Not a member of this workspace';
  end if;
  if v_run_id is null then
    raise exception 'This approval is not a release-gate approval';
  end if;
  if v_status <> 'pending' then
    raise exception 'This approval has already been decided';
  end if;

  update approvals set status = p_decision, decided_at = now()
  where id = p_approval_id;

  if p_decision = 'approved' then
    update orchestrate_runs set released_at = now()
    where id = v_run_id and workspace_id = v_ws;
  end if;
end;
$$;

revoke all on function decide_release_approval(text, text) from public;
grant execute on function decide_release_approval(text, text) to authenticated;
