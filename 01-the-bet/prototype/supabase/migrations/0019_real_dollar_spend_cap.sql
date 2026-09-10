-- Real dollar spend caps (feature-ideas.md / backlog.md "Real dollar
-- spend caps, not just a run-count cap").
--
-- migrations/0006's daily_orchestrate_limit counts *runs*, regardless of
-- what any one run actually costs — a workspace with unusually complex
-- objectives (more agents escalated to Opus, longer outputs) can burn
-- far more real budget than one with the same run count and cheap,
-- simple ones. This adds a second, real cap measured in actual dollars,
-- summed from the same real orchestrate_call_log telemetry the Model
-- Spend Dashboard's "Real Orchestrate spend" panel already reads —
-- checked in addition to (not instead of) the existing run-count cap,
-- so either one alone can stop a fresh run.

alter table public.workspaces add column daily_spend_cap_usd numeric(10, 2) not null default 5.00;

-- Backfill existing workspaces to their current plan's real cap instead
-- of leaving every pre-existing pro/enterprise workspace on the new
-- column's free-tier default.
update public.workspaces set daily_spend_cap_usd = case plan
  when 'free' then 5.00
  when 'pro' then 25.00
  when 'enterprise' then 150.00
  else daily_spend_cap_usd
end;

-- Same admin-only, plan-tied write path as daily_orchestrate_limit
-- (migrations/0009) — no client-facing UPDATE policy on workspaces at
-- all, so set_workspace_plan is still the only way either cap changes.
create or replace function public.set_workspace_plan(ws uuid, new_plan text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  new_limit int;
  new_spend_cap numeric(10, 2);
begin
  if not private.is_workspace_admin(ws) then
    raise exception 'Only a workspace admin can change its plan.';
  end if;
  if ws = '00000000-0000-0000-0000-000000000001' then
    raise exception 'The shared public demo workspace has no plan to change.';
  end if;

  new_limit := case new_plan
    when 'free' then 20
    when 'pro' then 100
    when 'enterprise' then 500
    else null
  end;
  new_spend_cap := case new_plan
    when 'free' then 5.00
    when 'pro' then 25.00
    when 'enterprise' then 150.00
    else null
  end;
  if new_limit is null then
    raise exception 'Unknown plan: %. Must be free, pro, or enterprise.', new_plan;
  end if;

  update public.workspaces
    set plan = new_plan, daily_orchestrate_limit = new_limit, daily_spend_cap_usd = new_spend_cap
    where id = ws;
end;
$$;

revoke execute on function public.set_workspace_plan(uuid, text) from public, anon;
grant execute on function public.set_workspace_plan(uuid, text) to authenticated;
