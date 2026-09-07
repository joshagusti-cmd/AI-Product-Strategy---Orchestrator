# The Prototype Bet

## What I Built
A clickable, multi-page governance platform prototype for the Aiven Agent Orchestrator, covering the surface a real buyer would expect from an "agent governance platform," not just the original single-screen demo:

- **Command Center** (`index.html`) — an executive enters a business objective, the orchestrator decomposes it into a task graph, assigns it across six specialized agents running on different models, pauses execution for human approval on a flagged risk, then produces a governed executive action plan with a full per-agent audit trail.
- **Agent Registry** (`agents.html`) — every agent the orchestrator governs, across departments, with tier (Leader/Filler/Killer/Core), assigned model, status, and what it can/can't do without a human.
- **Policy Editor** (`policies.html`) — the compliance-owner control surface: autonomy level, escalation risk threshold, and escalation rule per tier, editable instead of hardcoded (closes the "Policy editor for compliance owners" backlog item at prototype fidelity) — and, now that RBAC is real, actually restricted to the Admin/Compliance Owner roles rather than just labeled that way.
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
- **Real spend cap, tied to a real plan tier** — every workspace has a `plan` (Free/Pro/Enterprise → 20/100/500 Orchestrate runs per rolling 24h), enforced server-side in the Edge Function itself via the service role key, not just something the client checks. The Command Center shows a live "X/Y runs used today" count once signed in, and an admin can change the plan from the Workspace modal — no real billing/payment processing, "upgrading" just changes the enforced cap immediately.
- **Real teams/invites** — a workspace member can invite a teammate by email (the "Workspace" button in the auth widget); they join that workspace automatically the next time they sign in with that email, and a user who belongs to more than one workspace gets a switcher to pick which one is active. Not built yet: leaving a workspace, or changing your own role.
- **Real RBAC within a workspace** — three roles (Admin, Compliance Owner, Analyst) enforced at the RLS layer, not just the UI: Admin gates agent model reassignment and team management, Admin-or-Compliance-Owner gates policy edits and Shadow AI govern/kill decisions, and everything else (approving, running a Shadow AI scan, orchestrating) stays open to any member. Buttons and inputs a signed-in user's role doesn't cover are disabled in the UI, and the underlying database call would be rejected either way.
- **Real automatic model routing** — the Command Center's "Auto-route models by risk/complexity" toggle (on by default) hands model selection to the Edge Function itself: a real, deterministic three-tier cascade — cheap models for routine, low-stakes objectives, escalating to Claude Opus 4.8 on the higher-stakes steps when the objective's text matches governance/compliance/financial risk keywords or its department/data-source scope is large — mirroring the Leader/Filler/Killer cascade this product's own pricing model is built around (`03-the-margin/cost-curve.md`). The post-run toast names exactly which tier was picked and why. Turning the toggle off falls back to the manual per-agent dropdowns.

Full detail — schema, the auth/multi-tenancy model, what's still simplified about it, and the two manual steps (the `ANTHROPIC_API_KEY` secret + the auth redirect URL allowlist) — is in `supabase/README.md`.

## What's still simulated
Being direct about the remaining gap to "fully functional SaaS," per the Horizon 1/2 roadmap:
- **Teams and RBAC are real, but the three roles are fixed bundles** — a workspace member can invite a teammate by email with a chosen role (Admin/Compliance Owner/Analyst), and they join automatically; an admin can change any other member's role or remove them. What's still open: no custom roles or fine-grained permissions beyond those three bundles, and no self-service "leave workspace" or self role-change. See `supabase/README.md` for the exact gaps.
- **No real integrations** — NetSuite/Salesforce/Zendesk/Snowflake/Workday are chips in the UI, not live connections.
- **Cost and reliability figures are modeled**, not measured — they're transcribed from `03-the-margin/cost-curve.md` and `04-the-contract/golden-dataset.md`, not live telemetry.
- **Model routing (manual and automatic) is real but Claude-only** — reassigning an agent's model in the Command Center, or letting Auto-route pick it, actually changes which model runs that agent's real call (see `resolveAgentModel` / `computeAutoRoute` in `supabase/functions/orchestrate/index.ts`), not just a cosmetic label. Only "Claude Sonnet 5", "Claude Opus 4.8", and (in auto mode) "Claude Haiku 4.5" are real, though — no OpenAI or Google key is configured, so manually picking "GPT-4o" or "Gemini 1.5 Pro" falls back to that agent's Claude default and surfaces a toast naming the substitution. True multi-provider support is the natural next step.
- **Auto-routing is a real heuristic, not a trained risk model** — it only sees the objective's text (keyword-matched) and how many departments/sources are in scope, not real transaction data or run history. Deterministic and explainable, but a first cut, not the sophisticated risk scoring `03-the-margin/cost-curve.md`'s Leader tier implies.
- **Plan tiers are real caps with no real billing** — Free/Pro/Enterprise genuinely change the enforced daily Orchestrate limit (20/100/500) via an admin-only RPC, but there's no Stripe integration, no invoice, no card on file, and no gate stopping an admin from "upgrading" for free. It's a real plan/cap relationship without real payment behind it.

Closing these is the rest of Horizon 2: true multi-provider support, the integrations catalog, and real billing/payment behind the plan tiers.

## The Bet in One Sentence
<!-- DRAFT below — this is your call, not mine. Edit or replace before treating it as final. -->
Aiven becomes the independent, model-agnostic orchestration and governance layer that enterprises trust to coordinate, approve, and audit every AI agent working across their business — the operating layer that sits above Claude, GPT, and whatever ships next.

## Kill Criteria
<!-- DRAFT below — same caveat. -->
Kill this bet if, after 3–5 real enterprise pilots, buyers consistently treat governance/orchestration as a feature they expect bundled free into OpenAI's, Microsoft's, or Google's own agent platforms rather than something worth paying an independent vendor to own — or if switching cost stays low enough that a customer could replicate the approval-and-audit workflow in a spreadsheet within a week.
