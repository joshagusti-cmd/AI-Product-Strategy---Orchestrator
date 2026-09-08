-- Saved objective templates — "run this same analysis monthly" without
-- retyping the objective, department/source scope, and model routing
-- every time. Unlike the telemetry/archive tables (orchestrate_usage,
-- orchestrate_call_log, orchestrate_runs, audit_qa_log), this is
-- user-authored data, not derived from a real Claude call — so it's
-- directly client-writable via RLS, the same pattern as policies/
-- approvals/shadow_tools, not insert-only via the service role key.
create table public.objective_templates (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  objective text not null,
  departments jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  auto_route boolean not null default true,
  -- Manual per-agent model picks, keyed by agent id (e.g.
  -- {"risk": "Claude Opus 4.8"}) — only meaningful when auto_route is
  -- false; mirrors the Command Center's agentModels shape exactly, so
  -- loading a template can just drop this straight into AGENTS.
  agent_models jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index objective_templates_workspace_idx
  on public.objective_templates (workspace_id, created_at desc);

alter table public.objective_templates enable row level security;

-- Open to any workspace member, same as orchestrating itself — saving
-- a shortcut for your own future runs isn't governance-sensitive.
create policy "select own workspace templates" on public.objective_templates for select
  using (private.is_workspace_member(workspace_id));
create policy "insert own workspace templates" on public.objective_templates for insert
  with check (private.is_workspace_member(workspace_id));
create policy "update own workspace templates" on public.objective_templates for update
  using (private.is_workspace_member(workspace_id)) with check (private.is_workspace_member(workspace_id));
create policy "delete own workspace templates" on public.objective_templates for delete
  using (private.is_workspace_member(workspace_id));
