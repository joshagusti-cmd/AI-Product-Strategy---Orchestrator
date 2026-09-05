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
- Replace simulated agent runs with real API calls to Claude, GPT, and Gemini behind a common orchestration interface
- Real auth + multi-tenant workspace model (SSO/RBAC)
- Persistent backend — **partially addressed at prototype fidelity**: the governance pages (Agent Registry, Policies, Approval Queue, Audit Trail, Shadow AI Audit) now share a localStorage-backed store (`01-the-bet/prototype/assets/data.js`) so state survives reload and carries across pages instead of resetting. That's still a client-side simulation, not a real shared backend — no multi-user state, no server, no durability beyond one browser.
- Integrations catalog for the data sources currently just listed as chips (NetSuite, Salesforce, Zendesk, Snowflake, Workday)

## Positioning to test with buyers
- Whether "kill switch" / vendor-portability messaging (see `02-the-moat/kill-switch.md`) belongs in the product UI itself, not just the pitch
- Whether pricing should be seat-based, usage-based, or outcome-based once real usage data exists (see `03-the-margin/cost-curve.md`)
