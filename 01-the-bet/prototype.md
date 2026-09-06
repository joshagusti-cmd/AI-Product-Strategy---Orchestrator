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

All six governance pages read and write a **real, shared Postgres database on Supabase** (`assets/data.js` talks to it directly via `supabase-js`, no build step) — approving something, saving a policy, or deciding a Shadow AI finding on one page shows up immediately on another, and now for every visitor, not just one browser. The Command Center's "Orchestrate" button calls a real Claude model through a Supabase Edge Function instead of a scripted timeline — see "Horizon 1: real backend + real model calls" below for what that means and what's still a tradeoff.

## Tool Used
Claude Code (Claude Sonnet 5) — hand-built HTML/CSS/JS, no framework, plus a Supabase Postgres database and Deno Edge Function for the backend (see `supabase/README.md`). Runs standalone in any browser, and deploys to GitHub Pages via `.github/workflows/deploy-pages.yml` (see the repo README for the live URL once Pages is enabled).

## Prototype Link
Source lives in this repo at [`prototype/`](prototype/) — open `prototype/index.html` directly in a browser, or use the GitHub Pages URL once enabled (Settings → Pages → Source: "GitHub Actions", a one-time repo-owner action this workflow can't do on its own).

An earlier single-page version of the Command Center was also published as a Claude Artifact: https://claude.ai/code/artifact/35c46725-ea55-4b4b-9a32-f4ab0388bf50

## AI Value Archetype
Orchestrator — consistent with the Module 1 diagnostic. It doesn't compete with Claude or GPT on raw model capability; it coordinates and governs them.

## Horizon 1: real backend + real model calls
The two lead items in Horizon 1 of `06-the-pitch/roadmap.md` are now built, at design-partner-demo fidelity:

- **Persistent, shared backend** — a real Supabase Postgres database (`supabase/migrations/`) with five tables (agents, policies, approvals, shadow tools, audit log), replacing the localStorage simulation. State now survives reloads and is shared across every visitor, not just cached per-browser.
- **Real model calls** — the Command Center's orchestration run calls a real Claude model through a Supabase Edge Function (`supabase/functions/orchestrate/`), which returns a genuinely model-generated executive summary, findings, recommendations, risk flags, and per-agent steps — not scripted copy. Read the function's comment for the honest framing: it's **one** real API call producing structured per-agent output, not six independent agent calls.

Full detail — schema, the security tradeoff of running without auth, and the one manual step (setting the `ANTHROPIC_API_KEY` secret) — is in `supabase/README.md`.

## What's still simulated
Being direct about the remaining gap to "fully functional SaaS," per the Horizon 1/2 roadmap:
- **No real auth or multi-tenancy** — every table is readable/writable by the public anon key (Horizon 2). Fine for a shared demo; not for real customer data.
- **No real integrations** — NetSuite/Salesforce/Zendesk/Snowflake/Workday are chips in the UI, not live connections.
- **Cost and reliability figures are modeled**, not measured — they're transcribed from `03-the-margin/cost-curve.md` and `04-the-contract/golden-dataset.md`, not live telemetry.
- **The orchestration run is one real call, not six** — see above. A true multi-agent architecture (independent calls per agent, able to use different models per tier as the UI implies) is a natural next step, not yet built.

Closing these is the rest of Horizon 1/2: auth/multi-tenancy and the integrations catalog.

## The Bet in One Sentence
<!-- DRAFT below — this is your call, not mine. Edit or replace before treating it as final. -->
Aiven becomes the independent, model-agnostic orchestration and governance layer that enterprises trust to coordinate, approve, and audit every AI agent working across their business — the operating layer that sits above Claude, GPT, and whatever ships next.

## Kill Criteria
<!-- DRAFT below — same caveat. -->
Kill this bet if, after 3–5 real enterprise pilots, buyers consistently treat governance/orchestration as a feature they expect bundled free into OpenAI's, Microsoft's, or Google's own agent platforms rather than something worth paying an independent vendor to own — or if switching cost stays low enough that a customer could replicate the approval-and-audit workflow in a spreadsheet within a week.
