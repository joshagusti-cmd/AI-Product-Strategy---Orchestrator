# Cost Curve & Pricing Strategy

## Packaging Decision
<!-- Grounded in the Risk & Compliance Agent's transaction-fraud/dispute workflow — the Orchestrator packaged for a bank/fintech fraud & ops desk. Adjust if you intended a different vertical. -->

**Leader:** Transaction scanning and scam-analysis likelihood — the feature that sells the product. Fast, high-volume, high-confidence scoring on every transaction. This is the "why buy" moment: an analyst sees a risk score they'd otherwise have generated manually, at a fraction of the time.

**Filler:** Transaction additional context and summary — supporting detail (merchant history, prior disputes, related-account activity) that rounds out the Leader's score into something an analyst can act on without re-pulling data themselves. Doesn't drive the purchase decision on its own, but makes the Leader feature trustworthy enough to use.

**Killer:** Transaction dispute template generator — the flashiest, most expensive-to-serve feature, and the one most likely to erode margin if left unmetered. Long-form generative output, higher-quality model required (these documents may go to a bank or counterparty), and it's the feature customers will over-request once they see it works. Needs a usage cap or overage pricing from day one, not bolted on later.

**Killer usage:** Gated behind human approval — never auto-triggered. A template is only generated after an analyst confirms a transaction is a genuine dispute candidate (consistent with the Risk & Compliance Agent's existing approval-gate pattern). Assume ~8 generations per active seat per month at launch; priced as a metered add-on beyond an included allotment so heavy users don't silently erase the margin the Leader/Filler tiers protect.

## Cost Model

### Feature → Tier → Blended COGS
<!-- Applied-work exercise: map every AI feature to a model tier and calculate blended cost per request. -->

| Feature | Complexity | Model Tier | Cost/Req | Volume % | Weighted |
|---------|-----------|-----------|----------|----------|----------|
| Transaction scanning & scam-likelihood (Leader) | Simple | Small | $0.012 | 80% | $0.010 |
| Transaction context & summary (Filler) | Medium | Mid | $0.080 | 16% | $0.013 |
| Dispute template generator (Killer) | Complex | Frontier | $0.450 | 4% | $0.018 |
| **Blended** | | | | **100%** | **$0.041** |

Estimate, not false precision: ~188 AI requests/user/month (150 scans + 30 summaries + 8 dispute drafts) × $0.041 blended ≈ **$7.80/user/month in inference COGS**, before infrastructure, storage, and approval-workflow overhead.

### Per-User/Month

| Cost Category | Per-User/Month | Notes |
|--------------|----------------|-------|
| Inference (primary model) | $6.00 | Mid-tier summaries (30 × $0.08) + Frontier-tier dispute drafts (8 × $0.45) — the two escalation tiers |
| Inference (cascading/triage) | $1.80 | Small-tier transaction scans (150 × $0.012) — the Leader feature, runs on 100% of volume |
| Infrastructure | $3.10 | Orchestration runtime, API gateway, embeddings/lookup, observability — allocated per active seat |
| Data/storage | $0.65 | Transaction + audit trail retention (90-day default), embeddings index |
| Human-in-the-loop | $1.20 | Approval-queue workflow: alerting, escalation routing, audit logging for ~8 gate decisions/mo — infrastructure cost of the review loop, not reviewer labor (that's the customer's own staff) |
| **Total AI COGS** | **$12.75** | Estimate — validate against real usage once pilot data exists |

## Cascading Strategy
<!-- Cheap model → frontier model routing logic -->

**Triage model:** Small tier (e.g. Claude Haiku-class) — scores every transaction for scam likelihood. This is the Leader feature; it runs on 100% of volume, so cost-per-call discipline matters most here.

**Frontier model:** Frontier tier (e.g. Claude Opus-class) — reserved for the Killer-tier dispute template, ~4% of requests, always gated behind human approval before it runs. A Mid tier (e.g. Claude Sonnet-class) sits between the two for the Filler feature's contextual summary — ~16% of requests — escalated once a transaction clears the risk threshold but before any human has decided a dispute template is warranted.

**Routing rule:** Every transaction is scored on the Small tier. Above the risk threshold, escalate to the Mid tier for a contextual summary. Only after a human approves a dispute as genuine does the Frontier tier generate the template — never triggered by score alone.

**Expected cascade ratio:** 80% Small-only / 16% escalate to Mid / 4% escalate to Frontier (the 150 / 30 / 8 monthly volumes above).

## Pricing Model

**Current pricing:**
- N/A — pre-launch. Aiven's current revenue is consulting/advisory engagements, not recurring software revenue.

**Proposed AI pricing:**
- Strategy posture: Skim
- Pricing model: Outcome / Resolution
- Unit of work metered: Transaction scanned
- Base fee ($/month): $49
- Price per unit: $0.35
- Estimated units/user/month: 150 <!-- matches the Leader-tier volume already modeled in the Cost Model above, not a fresh assumption -->
- Implied revenue/user/month: $101.50

**Decision Note:** Why this pricing structure fits the buyer and the value delivered — customers pay per transaction scanned, the unit of work that maps directly to the outcome they're buying (fraud coverage), not a flat seat fee for a tool that might sit idle. Against the $12.75 Total AI COGS modeled above, implied gross margin is ~87%. Because revenue is metered on the same unit that drives most of the cost curve, revenue and COGS scale together as a customer's volume grows — a heavier desk pays more, but margin doesn't collapse the way it would under a flat fee (see the "Heaviest segment doubles" stress test below). The Killer-tier dispute-template generator stays metered separately as overage beyond an included allotment (see Packaging Decision above) rather than folded into the per-scan price — it's the one action expensive enough on its own to need its own cap, and bundling it in would make light scanners subsidize the few who generate a lot of dispute letters.

**Model:** hybrid (base fee + per-scan usage fee + separately metered Killer-tier overage)

## Stress Tests

| Scenario | Impact on Margin | Response |
|----------|-----------------|----------|
| Inference costs 3x | Inference COGS rises from $7.80 to $23.40/seat/mo; Total AI COGS rises to ~$28.35 — at $101.50/seat implied revenue, gross margin falls from ~87% to ~72% | Shift Small-tier volume (80% of all requests) to an even cheaper model first, tighten the Mid-tier escalation threshold, and let Frontier-tier overage pricing absorb the rest since it's already metered |
| Heaviest segment doubles | A desk running ~2x base volume (300 scans / 60 summaries / 16 drafts) pushes Total COGS to ~$21 — but because pricing is metered per scan, their revenue also roughly doubles to ~$154 ($49 base + 300 × $0.35), holding margin near ~86% instead of collapsing | The metering choice is already the mitigation here; still worth a "Pro" tier at very high volume so the base fee doesn't feel like a bait-and-switch |
| Model provider raises prices 50% | Adds ~$3.90/seat/mo to inference COGS ($7.80 → $11.70); Total AI COGS rises to ~$16.65 — margin falls from ~87% to ~84% | Model-agnostic routing (the core moat per `01-the-bet/diagnostic.md`) lets Aiven reroute the Small, Mid, or Frontier call to a competing provider within a release cycle — this is the entire reason the orchestration layer sits above any single model |

## Board One-Pager
<!-- Before/After: Old SaaS revenue vs. AI usage revenue for your product -->

**Before (traditional SaaS):** Flat per-seat license fee, ~85–90% gross margin, revenue disconnected from how much value a customer actually extracts. Aiven's real "before" is consulting/services revenue — project-based, not recurring.

**After (AI-enabled):** Base fee ($49/seat) plus per-transaction-scanned metering ($0.35/unit), with the Killer-tier dispute generator metered separately as overage. At the modeled 150 scans/user/month, implied revenue is $101.50/seat against $12.75 Total AI COGS — an estimated ~87% gross margin, in line with traditional SaaS despite the added inference cost, because pricing is tied to the same unit that drives most of the cost curve.

**Net margin shift:** Roughly flat versus pure SaaS at baseline volume, and more resilient than a flat-fee model under stress — since revenue scales with the metered unit, a heavier customer doesn't erode margin the way they would under a fixed seat price. The real margin risk isn't baseline volume, it's Killer-tier usage growing faster than its included allotment, which is exactly what the stress tests above are pressure-testing.
