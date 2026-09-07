-- Real Shadow AI discovery: adds `requested_model` to
-- orchestrate_call_log (migrations/0010) so a real Orchestrate call
-- that asked for a model with no real key configured (e.g. "GPT-4o",
-- "Gemini 1.5 Pro" — see MODEL_LABEL_TO_ID in
-- supabase/functions/orchestrate/index.ts) and got silently substituted
-- leaves a real, queryable trace, not just a one-off toast. Null for a
-- call that ran on exactly the model it asked for.
--
-- This — plus the real, already-persisted `agents.model` column — is
-- what the Shadow AI Audit's "Run Shadow AI Scan" now actually scans:
-- real Agent Registry entries whose declared model isn't one this
-- workspace can really call, and real runs that actually requested an
-- ungoverned model. No schema change needed for shadow_tools itself —
-- a finding from either source is just a real row there, exactly like
-- the old simulated ones, just derived from real data instead of a
-- fixed fictional list.
alter table public.orchestrate_call_log add column requested_model text;

comment on column public.orchestrate_call_log.requested_model is
  'The model label the caller actually asked for, when it differs from what really ran (a silent substitution — no real key configured for that provider). Null when the call ran on exactly the requested model.';
