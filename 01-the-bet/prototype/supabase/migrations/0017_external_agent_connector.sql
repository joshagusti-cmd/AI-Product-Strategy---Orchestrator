-- Universal external-agent connector: lets a workspace register an
-- agent it already runs somewhere else (any stack, any language) and
-- have it report real activity into the same Audit Trail, Agent
-- Registry, and (optionally) Approval Queue an internal Claude agent
-- uses. Aiven never executes an external agent -- it can only ever
-- observe and, if that agent's own code opts in, gate it -- the same
-- honest limit every governance platform has for something it doesn't
-- run itself.
--
-- `agent_type` distinguishes the two kinds of registry row now:
-- 'internal_claude' (the existing kind -- may or may not be part of the
-- real Orchestrate pipeline, per migrations/0016) and 'external' (never
-- part of that pipeline; reports in via functions/agent-events/).
alter table public.agents
  add column agent_type text not null default 'internal_claude' check (agent_type in ('internal_claude', 'external')),
  add column external_key_hash text,
  add column external_last_seen_at timestamptz,
  add column external_note text;

-- One real secret per external agent -- the raw key is generated and
-- shown to the admin exactly once at registration (client-side, never
-- stored), and only its SHA-256 hash lives here. A unique index means
-- the ingestion endpoint's lookup-by-hash is both fast and can never be
-- ambiguous between two agents.
create unique index agents_external_key_hash_unique on public.agents (external_key_hash) where external_key_hash is not null;

-- Real, append-only log of everything an external agent has actually
-- reported. Insert-only via the service role key (the agent-events
-- Edge Function, authenticated by the agent's own key, not a Supabase
-- user session) -- same pattern as orchestrate_call_log/
-- orchestrate_usage: a client can read its own workspace's rows via
-- RLS, but can never fabricate one by writing directly.
create table public.agent_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id text not null,
  event_type text not null check (event_type in ('activity', 'risk_flag')),
  title text not null,
  detail text,
  risk_severity text,
  risk_text text,
  approval_id text,
  created_at timestamptz not null default now()
);

alter table public.agent_events enable row level security;

create policy "select demo or member" on public.agent_events for select
  using (workspace_id = '00000000-0000-0000-0000-000000000001' or private.is_workspace_member(workspace_id));

comment on table public.agent_events is 'Real activity reported by external agents via functions/agent-events/, insert-only via the service role key. Mirrored into audit_log at write time so it shows up in the existing Audit Trail UI with no extra query.';
