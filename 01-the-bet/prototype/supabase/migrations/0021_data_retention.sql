-- Data residency / retention controls (feature-ideas.md / backlog.md
-- "Data residency / retention controls ... a real, workspace-
-- configurable auto-delete window for audit_log/orchestrate_runs; a
-- common real enterprise procurement ask (GDPR data-minimization) not
-- yet modeled"). A workspace admin sets a retention window in days (or
-- leaves it unset — no automatic deletion, the default, matching every
-- existing workspace's real behavior today). Real rows older than that
-- window actually get deleted, two ways: automatically, once a day, via
-- a real pg_cron job; and on demand, via an admin-only "Run retention
-- now" action, so a demo (or an actual admin) gets real, immediate
-- proof this works instead of a leap of faith about a background job.
-- Scoped exactly to what the backlog line names — audit_log and
-- orchestrate_runs — not every telemetry table in this schema (see
-- supabase/README.md for the honest scope note).

alter table public.workspaces add column audit_retention_days int;
alter table public.workspaces
  add constraint workspaces_audit_retention_days_check
  check (audit_retention_days is null or audit_retention_days between 30 and 3650);

-- Admin-only RPC: same "workspaces has no client-facing UPDATE policy,
-- this security-definer function is the sole write path" pattern as
-- set_workspace_plan/set_emergency_stop (migrations/0009, 0018).
create or replace function public.set_data_retention(ws uuid, days int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_email text;
begin
  if not private.is_workspace_admin(ws) then
    raise exception 'Only a workspace admin can change the data retention window.';
  end if;
  if ws = '00000000-0000-0000-0000-000000000001' then
    raise exception 'The shared public demo workspace has no real data to retain or delete.';
  end if;
  if days is not null and (days < 30 or days > 3650) then
    raise exception 'Retention window must be between 30 and 3650 days, or unset for no automatic deletion.';
  end if;

  update public.workspaces set audit_retention_days = days where id = ws;

  select email into actor_email from auth.users where id = auth.uid();
  insert into public.audit_log (workspace_id, actor, action, risk, detail)
  values (
    ws,
    coalesce(actor_email, 'Unknown admin'),
    case when days is null then 'Disabled the data retention auto-delete window' else 'Set the data retention window to ' || days || ' days' end,
    null,
    case when days is null
      then 'audit_log and orchestrate_runs rows are no longer automatically deleted for this workspace.'
      else 'audit_log and orchestrate_runs rows older than ' || days || ' days will be automatically deleted going forward.'
    end
  );
end;
$$;

revoke execute on function public.set_data_retention(uuid, int) from public, anon;
grant execute on function public.set_data_retention(uuid, int) to authenticated;

-- Real deletion, shared by the scheduled job and the on-demand admin
-- action below — one real delete path, not two that could quietly
-- drift apart.
create or replace function private.purge_workspace_data(ws uuid, days int, out audit_deleted int, out runs_deleted int)
returns record
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.audit_log
  where workspace_id = ws and ts < now() - (days || ' days')::interval;
  get diagnostics audit_deleted = row_count;

  delete from public.orchestrate_runs
  where workspace_id = ws and created_at < now() - (days || ' days')::interval;
  get diagnostics runs_deleted = row_count;
end;
$$;

-- The real scheduled enforcement: once a day, for every workspace that
-- actually has a retention window set, delete what's expired and log a
-- real audit_log entry naming exactly what was deleted. That entry is
-- itself subject to the same retention window going forward — an
-- honest, self-consistent minimization, not a special-cased exemption
-- for the platform's own enforcement record.
create or replace function private.purge_all_expired_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ws record;
  result record;
begin
  for ws in
    select id, audit_retention_days from public.workspaces where audit_retention_days is not null
  loop
    select * into result from private.purge_workspace_data(ws.id, ws.audit_retention_days);
    if result.audit_deleted > 0 or result.runs_deleted > 0 then
      insert into public.audit_log (workspace_id, actor, action, risk, detail)
      values (
        ws.id, 'Aiven Orchestrator', 'Enforced data retention window', null,
        'Deleted ' || result.audit_deleted || ' audit_log row(s) and ' || result.runs_deleted ||
        ' orchestrate_runs row(s) older than ' || ws.audit_retention_days || ' days, per this workspace''s configured retention window.'
      );
    end if;
  end loop;
end;
$$;

create extension if not exists pg_cron;
select cron.schedule('aiven-purge-expired-data', '0 3 * * *', $$select private.purge_all_expired_data();$$);

-- On-demand admin action: real, immediate deletion for this one
-- workspace — not a leap of faith about whether the daily cron job is
-- actually configured or running. Same underlying purge_workspace_data
-- the scheduled job uses, so the two paths can't drift. Requires a
-- retention window to already be set (nothing to enforce otherwise).
create or replace function public.run_data_retention_now(ws uuid, out audit_deleted int, out runs_deleted int)
returns record
language plpgsql
security definer
set search_path = public
as $$
declare
  days int;
  result record;
  actor_email text;
begin
  if not private.is_workspace_admin(ws) then
    raise exception 'Only a workspace admin can run data retention.';
  end if;
  select workspaces.audit_retention_days into days from public.workspaces where id = ws;
  if days is null then
    raise exception 'Set a retention window first.';
  end if;

  select * into result from private.purge_workspace_data(ws, days);
  audit_deleted := result.audit_deleted;
  runs_deleted := result.runs_deleted;

  select email into actor_email from auth.users where id = auth.uid();
  insert into public.audit_log (workspace_id, actor, action, risk, detail)
  values (
    ws, coalesce(actor_email, 'Unknown admin'), 'Ran data retention now', null,
    'Deleted ' || audit_deleted || ' audit_log row(s) and ' || runs_deleted || ' orchestrate_runs row(s) older than ' || days || ' days.'
  );
end;
$$;

revoke execute on function public.run_data_retention_now(uuid) from public, anon;
grant execute on function public.run_data_retention_now(uuid) to authenticated;
