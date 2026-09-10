-- Workspace-wide emergency stop (feature-ideas.md / backlog.md
-- "Workspace-wide emergency stop (distinct from per-agent disable)").
--
-- The per-agent Enabled toggle (migrations/0016) removes one agent from
-- the real pipeline. This is the bigger, blunter control an admin needs
-- in an actual incident: one real switch that freezes every real,
-- billed action in the workspace at once — a brand-new Orchestrate run,
-- resuming a paused one, and an external agent's own gate check — until
-- an admin turns it back off. It does not, and cannot, reach into code
-- Aiven doesn't run (see functions/agent-events/index.ts's own honest
-- limit) — it can only make the answer "no, not right now" the one real
-- answer available everywhere Aiven itself controls.

alter table public.workspaces add column emergency_stop boolean not null default false;
alter table public.workspaces add column emergency_stop_at timestamptz;
alter table public.workspaces add column emergency_stop_by_email text;

-- Admin-only RPC: the sole write path, same reasoning as
-- set_workspace_plan (migrations/0009) — workspaces has no client-facing
-- UPDATE policy at all, so a security-definer function is the only way
-- to flip this, and it's the one place that also stamps who/when and
-- writes the real audit_log entry every other governance action in this
-- schema gets.
create or replace function public.set_emergency_stop(ws uuid, active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_email text;
begin
  if not private.is_workspace_admin(ws) then
    raise exception 'Only a workspace admin can change the emergency stop.';
  end if;
  if ws = '00000000-0000-0000-0000-000000000001' then
    raise exception 'The shared public demo workspace has no Orchestrate runs to stop.';
  end if;

  select email into actor_email from auth.users where id = auth.uid();

  update public.workspaces set
    emergency_stop = active,
    emergency_stop_at = case when active then now() else null end,
    emergency_stop_by_email = case when active then actor_email else null end
  where id = ws;

  insert into public.audit_log (workspace_id, actor, action, risk, detail)
  values (
    ws,
    coalesce(actor_email, 'Unknown admin'),
    case when active then 'Activated workspace emergency stop' else 'Lifted workspace emergency stop' end,
    case when active then 'High' else null end,
    case when active
      then 'Every new Orchestrate run, every paused-run resume, and every external agent''s approval check is frozen until this is lifted.'
      else 'Orchestrate runs, paused-run resumes, and external agent approval checks are unfrozen.'
    end
  );
end;
$$;

revoke execute on function public.set_emergency_stop(uuid, boolean) from public, anon;
grant execute on function public.set_emergency_stop(uuid, boolean) to authenticated;
