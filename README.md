# AI Product Strategy — Orchestrator

> Aiven becomes the independent, model-agnostic orchestration and governance layer that enterprises trust to coordinate, approve, and audit every AI agent working across their business — the operating layer that sits above Claude, GPT, and whatever ships next.

---

## Strategy at a Glance

| Component | Module | Status | Key Artifact |
|-----------|--------|--------|-------------|
| **The Bet** | M1 | [x] | `01-the-bet/` |
| **The Moat** | M2 | [x] | `02-the-moat/` |
| **The Margin** | M3 | [x] | `03-the-margin/` |
| **The Contract** | M4 | [x] | `04-the-contract/` |
| **The Guardrails** | M5 | [x] | `05-the-guardrails/` |
| **The Pitch** | M6 | [x] | `06-the-pitch/` |

---

## The Bet (M1)

**What we're building, for whom, why now.**

- **Product:** Aiven Orchestrator (working name) — a multi-agent enterprise orchestration platform that lets organizations deploy, govern, monitor, and continuously optimize AI agents across every business function from a single operating layer.
- **AI Value Archetype:** Orchestrator — it doesn't compete with Claude or GPT on raw model capability; it coordinates and governs them.
- **Vulnerability Scores:** Moat 4/5 · Data 5/5 · Platform 3/5
- **Top Risk:** becoming perceived as "another AI agent builder" instead of the enterprise AI operating system that governs, measures, and orchestrates every AI capability across the organization.
- **Confidence:** M
- **Prototype:** a multi-page governance platform demo lives in this repo at [`01-the-bet/prototype/`](01-the-bet/prototype/) — Command Center, Agent Registry, Policy Editor, Approval Queue, Audit Trail, Workflow History, Model Spend Dashboard, and Shadow AI Audit, backed by a **real Supabase Postgres database**, **real multi-tenant auth with teams and RBAC** (email magic-link sign-in, an isolated private workspace auto-provisioned per user, real email invites with a chosen role so a member can add a teammate to their workspace, three roles enforced by RLS — Admin, Compliance Owner, Analyst — not just labeled, a read-only public demo for anonymous visitors), and **six real, independent Claude API calls with real model routing, manual or automatic** (one call per agent, each seeing the prior agents' actual output; by default a real risk-keyword + scope-size cascade picks each agent's model, escalating to Opus 4.8 only where warranted, with a manual per-agent override available) powering the Command Center's orchestration run, gated to signed-in users and capped by a per-workspace rolling-24h spend limit tied to a real plan tier (Free/Pro/Enterprise → 20/100/500 runs/day, admin-changeable, no real billing behind it yet) enforced server-side, with **real, measured spend telemetry** (every real call's actual model + token usage, priced at real Anthropic rates, on the Model Spend Dashboard) replacing modeled cost-curve numbers for that part of the dashboard, and a **Policy Editor that actually gates the pipeline** — set the workspace's Core-tier policy to "Approval-required" or "Two-gate" and a run whose Risk & Compliance Agent flag crosses the threshold genuinely pauses before the Strategy/Writer calls (and their cost) happen, waiting on a real approval to resume or a real rejection to end it. The **Shadow AI Audit's scan is real too now** — it finds actual Agent Registry drift and real ungoverned-model requests from this workspace's own Orchestrate telemetry, not a fixed list of fictional findings (though it still can't see outside tool use like a personal ChatGPT account, which would need real endpoint/CASB integration this prototype doesn't have). Every completed run is also archived in full now — a new **Workflow History** page lets you search and reopen any past run's real deliverable, not just the Audit Trail's one-line pointer to it. The **Audit Trail can now answer real questions** too — "Ask the audit trail" is a real Claude call grounded strictly in the workspace's own real log entries, gated to signed-in users and rate-limited server-side. The Command Center can also **save the current objective as a reusable template** — scope, auto-route setting, and per-agent model picks included — and load it back in later. The Agent Registry, Approval Queue, and Workflow History are now **filterable by real department**, built from whatever departments actually show up in each page's own data (see `01-the-bet/prototype/supabase/`). There's now a **real mobile companion for the Approval Queue** too (`mobile-approvals.html`) — a genuinely phone-first page, not a squeezed desktop table, reading a lean dedicated query and deciding through the same real approve/reject/resume path as the full console. A living **[User Guide](01-the-bet/prototype/USER_GUIDE.md)** walks through every page for someone actually using the console, updated alongside each feature as it ships. Open `01-the-bet/prototype/index.html` directly in a browser, or see it live via GitHub Pages once enabled (Settings → Pages → Source: "GitHub Actions" — see `.github/workflows/deploy-pages.yml`). An earlier single-page version is also published as a Claude Artifact: https://claude.ai/code/artifact/35c46725-ea55-4b4b-9a32-f4ab0388bf50
- **Kill Criteria:** kill this bet if, after 3–5 real enterprise pilots, buyers consistently treat governance/orchestration as a feature they expect bundled free into OpenAI's, Microsoft's, or Google's own agent platforms rather than something worth paying an independent vendor to own — or if switching cost stays low enough that a customer could replicate the approval-and-audit workflow in a spreadsheet within a week.

→ Details: [`01-the-bet/`](01-the-bet/)

---

## The Moat (M2)

**Why this won't get copied in 6 months.**

- **Data Flywheel Score:** 18/20
- **Weakest Loop:** Preference and Domain Context loops (tied at 4/5)
- **Competitive Position:** high switching cost, high data advantage, moderate platform exposure — positioned as the neutral orchestration layer above three named attackers: Microsoft (platform bundler, 65% of value at risk within 6 months), Decagon (vertical point-solution depth in customer service), and ServiceNow (adjacent workflow-platform expansion).
- **Encroachment Defense:** model-agnostic architecture plus Ready vendor portability — the moat doesn't depend on which foundation model sits underneath, so a competitor bundling one model's agents can't cut off the workflows, governance, and audit history that live in Aiven.
- **Vendor Portability:** Ready — ~24–48h provider swap, no change to application code, customer workflows, or governance policy.

→ Details: [`02-the-moat/`](02-the-moat/)

---

## The Margin (M3)

**Will this make money or bleed it?**

- **Gross Margin (current):** N/A — pre-launch; Aiven's current revenue is consulting/advisory, not software. Traditional SaaS baseline used for comparison: ~85–90%.
- **Gross Margin (AI-adjusted):** ~87%
- **Pricing Model:** hybrid — base fee + per-transaction-scanned usage fee, with the Killer-tier dispute generator metered separately as overage
- **Pricing Today → Tomorrow:** consulting/advisory engagements (pre-launch) → $49 base + $0.35/scan, ~$101.50/user/month implied revenue at modeled volume
- **Total AI COGS / unit:** $12.75/user/month
- **Cascading Strategy:** Small tier scores every transaction (Leader, 80% of volume); Mid tier drafts contextual summaries once a transaction clears the risk threshold (Filler, 16%); Frontier tier drafts dispute templates, gated behind explicit human approval (Killer, 4%).
- **Net Margin Shift:** roughly flat versus pure SaaS at baseline volume, and more resilient under stress than a flat-fee model, since revenue scales with the same metered unit that drives most of the cost curve.
- **Break-even at:** not yet modeled — requires CAC and fixed opex assumptions not yet captured in this repo.

→ Details: [`03-the-margin/`](03-the-margin/)

---

## The Contract (M4)

**Why users will trust a probabilistic system.**

- **Reliability Target:** ≥92% Leader-tier accuracy · <1% hallucination rate · p95 latency <2s / <6s / <15s by tier · <5% weekly score drift
- **Golden Dataset:** 5 rows, 2 adversarial
- **Confidence UX:** tiered confidence + human-in-loop trigger, combined — the score is always shown, but how much scaffolding an analyst gets (never whether a human is in the loop for irreversible actions) changes by tier.
- **HITL Architecture:** three gates matching the model tiers — Leader-tier scoring is fully autonomous; Filler-tier auto-escalates into an analyst's approval queue; Killer-tier never generates without an explicit analyst approval, and every override feeds back into the Correction Loop.
- **Failure Mode Coverage:** a model producing a fluent, confident, well-formatted dispute letter that asserts something the underlying transaction data doesn't support, rather than recognizing the contradiction and stopping short of the Killer-tier gate. *(Draft finding — pending a real red-team session with a partner.)*

→ Details: [`04-the-contract/`](04-the-contract/)

---

## The Guardrails (M5)

**What breaks when this scales, and what compounds.**

- **Compounding System:** 3 feedback loops — Recursive Learning is active; Cross-Domain Transfer and Network Intelligence are still missing. Network Intelligence is the identified broken loop: customer-service reports don't reach training data today.
- **Governance Posture:** AI detection of potential scams and fraudulent transactions during the customer transaction flow. Excludes post-transaction analysis and anti-financial-crime monitoring.
- **Autonomy Boundaries:** Leader-tier scoring runs fully autonomously (advisory-only); anything from Filler tier up requires human review, and the Killer-tier dispute template requires two separate explicit approvals — one to generate, one to send.
- **Escalation Triggers:** a transaction crosses the risk threshold; an analyst override reverses a High-risk flag; or any Reliability Contract alert threshold is breached.
- **Audit Cadence:** real-time audit-trail logging on every action, weekly reliability sampling, quarterly Shadow AI Audit.
- **Shadow AI Status:** 3 tools found (illustrative, pending a real audit) — 2 governed, 1 killed (unmanaged personal ChatGPT use handling real customer PII).
- **Agent Boundaries:** 4 agents mapped to the Small/Mid/Frontier tiers — Scanning, Context, Dispute, and a cross-cutting Compliance/Audit agent that flags but never overrides a human decision.
- **Regulatory Exposure:** EU AI Act, GDPR, and sector AML obligations apply. Draft read: Limited risk tier under the EU AI Act's fraud-detection carve-out — not yet confirmed by counsel.

→ Details: [`05-the-guardrails/`](05-the-guardrails/)

---

## The Pitch (M6)

**How you get this funded, shipped, and adopted.**

- **Horizon 1 (Now):** move off the prototype (real model calls + persistent backend) with a design-partner pilot; close the Network Intelligence loop; verify kill-switch failover; validate pricing with real buyers; run a real Shadow AI Audit.
- **Horizon 2 (Next):** ship the Killer-tier dispute generator to production; build the Cross-Domain Transfer loop into AML scoring; legal review + real break-even modeling; real red-team session; auth/routing/integrations buildout.
- **Horizon 3 (Bet):** expand beyond the fraud/dispute wedge into a second department vertical; revisit the rest of `feature-ideas.md`.
- **Board Narrative:** Aiven is the independent, model-agnostic orchestration and governance layer enterprises trust to coordinate, approve, and audit every AI agent working across their business.
- **Key Metric:** flywheel loops active — currently 2 of 4; the moat isn't real until Cross-Domain Transfer and Network Intelligence move from missing to active.
- **The Ask:** design-partner budget plus engineering capacity to close the two missing flywheel loops and take the Killer-tier flow from prototype to production before a well-resourced incumbent bundles equivalent governance into a footprint enterprises already have installed.
- **Strategic Shift (M1 → Now):** from an all-department platform pitch to a single fraud/dispute vertical wedge, proven end-to-end before expanding.

→ Details: [`06-the-pitch/`](06-the-pitch/)
