# The Prototype Bet

## What I Built
A clickable, multi-page governance platform prototype for the Aiven Agent Orchestrator, covering the surface a real buyer would expect from an "agent governance platform," not just the original single-screen demo:

- **Command Center** (`index.html`) — an executive enters a business objective, the orchestrator decomposes it into a task graph, assigns it across six specialized agents running on different models, pauses execution for human approval on a flagged risk, then produces a governed executive action plan with a full per-agent audit trail.
- **Agent Registry** (`agents.html`) — every agent the orchestrator governs, across departments, with tier (Leader/Filler/Killer/Core), assigned model, status, and what it can/can't do without a human.
- **Policy Editor** (`policies.html`) — the compliance-owner control surface: autonomy level, escalation risk threshold, and escalation rule per tier, editable instead of hardcoded (closes the "Policy editor for compliance owners" backlog item at prototype fidelity).
- **Approval Queue** (`approvals.html`) — the org-wide backlog of agent actions waiting on a human decision, filterable by risk.
- **Audit Trail** (`audit.html`) — a searchable, exportable (JSON/CSV) real-time log of every agent and human action, matching the audit cadence in the Governance Policy.
- **Model Spend Dashboard** (`spend.html`) — cost by tier and by model provider, tied to the cascading Leader/Filler/Killer pricing model in `03-the-margin/cost-curve.md`; the provider breakdown is live off the Agent Registry's current model assignments.
- **Shadow AI Audit** (`shadow-ai.html`) — the illustrative shadow-tool findings from `05-the-guardrails/compounding-system.md`, plus a "Run Shadow AI Scan" action that simulates discovering new unmanaged tool use and routes it to a govern/kill decision.

All six governance pages read and write a **real Postgres database on Supabase** (`assets/data.js` talks to it directly via `supabase-js`, no build step), with **real multi-tenant auth**: anonymous visitors get a read-only view of a shared public demo, and signing in (email magic link, no password) auto-provisions your own private, isolated workspace — approving something, saving a policy, or deciding a Shadow AI finding shows up immediately across pages, scoped to whichever workspace you're in. The Command Center's "Orchestrate" button calls a real Claude model through a Supabase Edge Function instead of a scripted timeline, gated to signed-in users since it's a real, metered API call — see "Horizon 1 → 2: real backend, real model calls, real auth" below.

## Tool Used
Claude Code (Claude Sonnet 5) — hand-built HTML/CSS/JS, no framework, plus a Supabase Postgres database and Deno Edge Function for the backend (see `supabase/README.md`). Runs standalone in any browser, and deploys to GitHub Pages via `.github/workflows/deploy-pages.yml` (see the repo README for the live URL once Pages is enabled).

## Prototype Link
Source lives in this repo at [`prototype/`](prototype/) — open `prototype/index.html` directly in a browser, or use the GitHub Pages URL once enabled (Settings → Pages → Source: "GitHub Actions", a one-time repo-owner action this workflow can't do on its own).

An earlier single-page version of the Command Center was also published as a Claude Artifact: https://claude.ai/code/artifact/35c46725-ea55-4b4b-9a32-f4ab0388bf50

## AI Value Archetype
Orchestrator — consistent with the Module 1 diagnostic. It doesn't compete with Claude or GPT on raw model capability; it coordinates and governs them.

## Horizon 1 → 2: real backend, real model calls, real auth
The lead items across Horizon 1 and the start of Horizon 2 in `06-the-pitch/roadmap.md` are now built, at design-partner-demo fidelity:

- **Persistent backend** — a real Supabase Postgres database (`supabase/migrations/`) with five tables (agents, policies, approvals, shadow tools, audit log), replacing the localStorage simulation.
- **Real, independent multi-agent orchestration** — the Command Center's orchestration run is six real, independent Claude API calls through a Supabase Edge Function (`supabase/functions/orchestrate/`), one per agent, run in the same Research → Finance → Ops → Risk & Compliance → Strategy → Executive Writer order the UI narrates, each agent seeing the prior agents' actual output as context. The Risk & Compliance step runs on Claude Opus 4.8 (the highest-stakes step gets the most capable model); everything else runs on Claude Sonnet 5. The Writer's call also synthesizes the run's executive summary, findings, recommendations, and risk flags from what the other five actually found — not scripted copy, and not one call inventing all six steps at once.
- **Real multi-tenant auth** — email magic-link sign-in (no passwords), with a public read-only demo workspace and a private, isolated, auto-provisioned workspace per signed-in user. Orchestrating (a real, metered API call) requires signing in — the Edge Function itself rejects anonymous requests, so a random visitor can't run up the API bill.
- **Real spend cap** — every workspace has a rolling-24h Orchestrate limit (default 20 calls), enforced server-side in the Edge Function itself via the service role key, not just something the client checks. The Command Center shows a live "X/Y runs used today" count once signed in.

Full detail — schema, the auth/multi-tenancy model, what's still simplified about it, and the two manual steps (the `ANTHROPIC_API_KEY` secret + the auth redirect URL allowlist) — is in `supabase/README.md`.

## What's still simulated
Being direct about the remaining gap to "fully functional SaaS," per the Horizon 1/2 roadmap:
- **Auth is one-workspace-per-user, no teams/invites/RBAC yet** — a real design partner would want to add teammates to one shared workspace with different roles (analyst vs. compliance owner vs. admin); that's not built, only the single-owner-per-workspace case is. See `supabase/README.md` for the exact gaps.
- **No real integrations** — NetSuite/Salesforce/Zendesk/Snowflake/Workday are chips in the UI, not live connections.
- **Cost and reliability figures are modeled**, not measured — they're transcribed from `03-the-margin/cost-curve.md` and `04-the-contract/golden-dataset.md`, not live telemetry.
- **Model per agent is fixed server-side, not driven by the Command Center's model dropdown** — the six agents' models are hardcoded in the Edge Function (Opus 4.8 for Risk & Compliance, Sonnet 5 for the rest), not read from the UI's per-agent reassignment control. Wiring that selector to real per-call routing, and true multi-provider support (Claude only today — the "GPT-4o"-labeled agents from the original design now run on Sonnet 5, and the UI labels were updated to match so nothing overclaims a provider that isn't being called), are the natural next steps — see `06-the-pitch/roadmap.md`'s "cost-based automatic model routing" item.
- **Spend cap is a single hardcoded default, not plan/billing-tied** — every workspace gets the same 20-calls-per-24h limit; there's no admin UI to change one workspace's limit (would need a direct SQL update today), and no notion of a paid tier with a higher cap.

Closing these is the rest of Horizon 2: teams/RBAC, the integrations catalog, and usage-based spend controls.

## The Bet in One Sentence
<!-- DRAFT below — this is your call, not mine. Edit or replace before treating it as final. -->
Aiven becomes the independent, model-agnostic orchestration and governance layer that enterprises trust to coordinate, approve, and audit every AI agent working across their business — the operating layer that sits above Claude, GPT, and whatever ships next.

## Kill Criteria
<!-- DRAFT below — same caveat. -->
Kill this bet if, after 3–5 real enterprise pilots, buyers consistently treat governance/orchestration as a feature they expect bundled free into OpenAI's, Microsoft's, or Google's own agent platforms rather than something worth paying an independent vendor to own — or if switching cost stays low enough that a customer could replicate the approval-and-audit workflow in a spreadsheet within a week.
