-- Plan tiers: ties the per-workspace Orchestrate spend cap
-- (migrations/0006) to a named plan instead of one hardcoded default
-- for every workspace. No real billing/payment processing — this is a
-- real, enforced cap change, not a real purchase; see supabase/README.md.

alter table public.workspaces add column plan text not null default 'free';
alter table public.workspaces
  add constraint workspaces_plan_check check (plan in ('free', 'pro', 'enterprise'));

-- Admin-only RPC: the only way a workspace's plan (and therefore its
-- Orchestrate cap) changes. workspaces has no client-facing UPDATE
-- policy at all (see migrations/0003) — this security-definer function
-- is deliberately the sole write path, so "upgrading" always goes
-- through the fixed plan->limit table below, never an arbitrary number.
create or replace function public.set_workspace_plan(ws uuid, new_plan text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  new_limit int;
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
  if new_limit is null then
    raise exception 'Unknown plan: %. Must be free, pro, or enterprise.', new_plan;
  end if;

  update public.workspaces set plan = new_plan, daily_orchestrate_limit = new_limit where id = ws;
end;
$$;

revoke execute on function public.set_workspace_plan(uuid, text) from public, anon;
grant execute on function public.set_workspace_plan(uuid, text) to authenticated;
