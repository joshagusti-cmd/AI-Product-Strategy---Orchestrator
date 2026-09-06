# Feature Ideas Backlog

Running list of ideas surfaced while building the prototype that are out of scope for the current clickable demo. Nothing here is committed — triage into a module (or into a real build) when there's time.

## Product surface
- Per-department drill-down analytics (click a KPI tile → filtered view scoped to that department's agents/workflows)
- Workflow history / versioned deliverable archive (compare this quarter's action plan to last quarter's)
- Natural-language audit trail Q&A — "why did the Risk agent flag this?" answered from the audit log
- Slack/Teams-native approval actions (approve/reject without opening the console)
- Mobile companion view scoped to just the approval queue, for executives on the go
- Saved objective templates ("run this same analysis monthly")

## Governance & model management
- Cost-based automatic model routing (cascade cheap→frontier model by task risk/complexity, referenced in `03-the-margin/cost-curve.md`)
- ~~Org-wide model spend dashboard broken out by agent, department, and provider~~ — **built at prototype fidelity**: `01-the-bet/prototype/spend.html`. Real spend telemetry (vs. modeled cost-curve numbers) is still open.
- ~~Policy editor — let a compliance owner define approval thresholds per risk tier instead of hardcoding them~~ — **built at prototype fidelity**: `01-the-bet/prototype/policies.html`. Wiring it to actually gate a real agent's behavior is still open.
- ~~Shadow AI discovery scan (tie-in to `05-the-guardrails/compounding-system.md`'s Shadow AI Audit)~~ — **built at prototype fidelity**: `01-the-bet/prototype/shadow-ai.html`. Replacing the simulated scan with a real discovery audit is still open (see the Horizon 1 item in `06-the-pitch/roadmap.md`).

## Platform / real build
- ~~Replace simulated agent runs with real API calls to Claude, GPT, and Gemini behind a common orchestration interface~~ — **built, partially**: the Command Center's orchestration run calls a real Claude model via a Supabase Edge Function (`01-the-bet/prototype/supabase/functions/orchestrate/`). It's one real call producing structured per-agent output, not six independent agent calls, and not yet multi-provider (Claude only). See `01-the-bet/prototype.md`.
- ~~Real auth + multi-tenant workspace model (SSO/RBAC)~~ — **built, partially**: email magic-link sign-in with a real per-user private workspace, auto-provisioned and RLS-isolated, plus a read-only public demo for anonymous visitors (`01-the-bet/prototype/supabase/migrations/0003`–`0005`). Not yet built: SSO, teams/invites (one workspace per user only), and RBAC within a workspace. See `01-the-bet/prototype/supabase/README.md`.
- ~~Persistent backend~~ — **built**: a real Supabase Postgres database (`01-the-bet/prototype/supabase/migrations/`) replaces the localStorage simulation. State is now shared across every visitor, not just carried across pages in one browser.
- Integrations catalog for the data sources currently just listed as chips (NetSuite, Salesforce, Zendesk, Snowflake, Workday)

## Positioning to test with buyers
- Whether "kill switch" / vendor-portability messaging (see `02-the-moat/kill-switch.md`) belongs in the product UI itself, not just the pitch
- Whether pricing should be seat-based, usage-based, or outcome-based once real usage data exists (see `03-the-margin/cost-curve.md`)
