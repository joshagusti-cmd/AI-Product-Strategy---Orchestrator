# AI Product Strategy   Orchestrator

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

- **Product:**
- **AI Value Archetype:** Orchestrator — consistent with the Module 1 diagnostic. It doesn't compete with Claude or GPT on raw model capability; it coordinates and governs them.
- **Vulnerability Scores:** _(add: Moat _/5 · Data _/5 · Platform _/5)_
- **Top Risk:** The greatest strategic risk is becoming perceived as "another AI agent builder" instead of the enterprise AI operating system that governs, measures, and orchestrates every AI capability across the organization.
- **Confidence:** _(add: H / M / L)_
- **Prototype:** https://claude.ai/code/artifact/35c46725-ea55-4b4b-9a32-f4ab0388bf50
- **Kill Criteria:** Kill this bet if, after 3–5 real enterprise pilots, buyers consistently treat governance/orchestration as a feature they expect bundled free into OpenAI's, Microsoft's, or Google's own agent platforms rather than something worth paying an independent vendor to own — or if switchi…

→ Details: [`01-the-bet/`](01-the-bet/)

---

## The Moat (M2)

**Why this won't get copied in 6 months.**

- **Data Flywheel Score:**
- **Weakest Loop:**
- **Top Encroachment Threat:** Microsoft
- **Encroachment Defense:** ---
- **Vendor Portability:** Ready - estimated provider swap time is 24-48 hours. The architecture supports replacing foundation models without changing application code, customer workflows, or governance policies. The main remaining dependency is keeping automated evaluation pipelines that confirm a replacement provider hits equivalent business outcomes before traffic shifts.

→ Details: [`02-the-moat/`](02-the-moat/)

---

## The Margin (M3)

**Will this make money or bleed it?**

- **Gross Margin (current):** 90%
- **Gross Margin (AI-adjusted):** 87%
- **Pricing Model:** hybrid (base fee + per-scan usage fee + separately metered Killer-tier overage)
- **Pricing Today → Tomorrow:** - N/A — pre-launch. Aiven's current revenue is consulting/advisory engagements, not recurring software revenue. → - Strategy posture: Skim
- **Total AI COGS / unit:** $12.75
- **Cascading Strategy:** Triage: Small tier (e.g. Claude Haiku-class) — scores every transaction for scam likelihood. This is the Leader feature; it runs on 100% of volume, so cost-per-call discipline matters most here.; frontier: Frontier tier (e.g. Claude Opus-class) — reserved for the Killer-tier dispute template, ~4% of requests, always gated behind human approval before it runs. A Mid tier (e.g. Claude Sonnet-class) sits between the two for the Filler feature's contextual summary — ~16% of requests — escalated once a transaction clears the risk threshold but before any human has decided a dispute template is warranted.; ratio 80% Small-only / 16% escalate to Mid / 4% escalate to Frontier (the 150 / 30 / 8 monthly volumes above).
- **Net Margin Shift:** Roughly flat versus pure SaaS at baseline volume, and more resilient than a flat-fee model under stress since revenue scales with the metered unit; a heavier customer doesn't erode margin the way they…
- **Break-even at:**

→ Details: [`03-the-margin/`](03-the-margin/)

---

## The Contract (M4)

**Why users will trust a probabilistic system.**

- **Reliability Target:**
- **Golden Dataset:** 5 rows, 2 adversarial
- **Confidence UX:** Tiered confidence + human-in-loop trigger, combined — the score is always shown, but how much scaffolding an analyst gets (and never whether a human is in the loop for irreversible actions) changes by tier.
- **HITL Architecture:** **Trigger — when does a human enter the loop?** Entry point depends on tier. Leader-tier scoring never triggers a human — every transaction is scored automatically, which is the point of the tool.…
- **Failure Mode Coverage:** *What failure mode did your partner find that you missed?*

→ Details: [`04-the-contract/`](04-the-contract/)

---

## The Guardrails (M5)

**What breaks when this scales, and what compounds.**

- **Compounding System:** | Loop | Input | Output | Compounds? | Status | |------|-------|--------|-----------|--------| | Recursive Learning | Transaction data from true positives and false negatives | Feeds into monthly model retraining | Y | a…
- **Governance Posture:** AI detection of potential scams and fraudulent transactions during the customer transaction flow. Excludes: post-transaction analysis and anti-financial-crime monitoring.
- **Autonomy Boundaries:** - OK solo: Leader-tier (Small model) scoring runs on every transaction fully autonomously — it's advisory-only, produces a score and flags, and never acts on them.
- **Escalation Triggers:** When humans must enter —
- **Audit Cadence:** Real-time audit-trail logging on every action (matches the Orchestrator's existing audit-trail pattern), weekly reliability sampling (matches the Accuracy and Hallucination-rate measurement cadence in…
- **Shadow AI Audit (user-side):** 3 workarounds found · 2 governed, 1 killed build candidates · adjacent spend Low in direct license cost (personal LLM accounts are typically free or individually expensed), but the real cost is uncontrolled PII exposure and inconsistent audit coverage, not a subscription line item.
- **Agent Boundaries:** | Agent | Tier | Can | Can't | Approval needed | |-------|------|-----|-------|-----------------| | Scanning Agent | Small (Leader) | Score every transaction for scam likelihood, apply flags | Contact customers, generate documents, take any…
- **Regulatory Exposure:** - Regimes that apply: EU AI Act, GDPR (transaction and customer data is personal data), sector-specific financial-crime regulation (e.g. AML/BSA-equivalent obligations depending on jurisdiction).

→ Details: [`05-the-guardrails/`](05-the-guardrails/)

---

## The Pitch (M6)

**How you get this funded, shipped, and adopted.**

- **Horizon 1 (Now):**
- **Horizon 2 (Next):**
- **Horizon 3 (Bet):**
- **Board Narrative:** **The case:**
- **Ask:** ## M1 Baseline vs. Now
- **Key Strategic Change:**

→ Details: [`06-the-pitch/`](06-the-pitch/)
