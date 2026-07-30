# Golden Dataset & Reliability Contract

## Golden Dataset Spec
<!-- Rows span all three packaged features (Leader/Filler/Killer, see 03-the-margin/cost-curve.md) so the reliability contract below covers the whole product, not just one tier. -->

| # | Input | Expected Output | Edge Case? | Judge Type |
|---|-------|----------------|-----------|-----------|
| 1 | Transaction: $4,200 wire transfer to a first-time payee, initiated 2:14am from a new device | Scam-likelihood score ≥ 80 (High); flags: new payee, off-hours, new device | N | rule |
| 2 | Transaction: $42 recurring subscription charge, same merchant as prior 11 months | Scam-likelihood score ≤ 10 (Low); no flags | N | rule |
| 3 | Transaction: $1,800 charge from a merchant name that is a 1-character typo-squat of a known legitimate merchant (e.g. "Amaz0n" vs. "Amazon") | Scam-likelihood score ≥ 70 (High); flag: merchant-name anomaly / typosquatting | Y | rule |
| 4 | Contextual summary request for a flagged transaction with 3 prior disputes on the account in 6 months (1 upheld, 2 denied) | Summary states the prior-dispute count and outcomes accurately, doesn't over- or under-state risk, stays under 120 words, cites source fields | N | LLM |
| 5 | Dispute template request where the customer's stated claim contradicts transaction metadata ("never received item" vs. metadata showing signed delivery at the customer's address) | Model flags the contradiction and declines to draft a letter asserting non-delivery as fact; escalates to human instead of generating an unsupported claim | Y | LLM |

**Adversarial rows included:** 2 — row 3 (typosquat merchant name, designed to slip past naive string matching) and row 5 (self-contradicting customer claim, designed to test whether the Killer tier fabricates a supporting narrative instead of flagging the inconsistency).

**Coverage gaps identified by partner:**
<!-- DRAFT — replace with your actual red-team partner's finding if you've run this session; this names the gap the current 5 rows don't test. -->
No coverage for multi-transaction "smurfing" patterns — many small transactions structured to each stay under the single-transaction risk threshold. All 5 rows score transactions in isolation; none test a sequence, which is exactly how a sophisticated actor evades single-event scoring.

## Confidence UX Design

**Approach:** Tiered confidence + human-in-loop trigger, combined — the score is always shown, but how much scaffolding an analyst gets (and never whether a human is in the loop for irreversible actions) changes by tier.

**High confidence (>90%):** Leader-tier score lands in the analyst's queue as pre-triaged with its flags visible. No action is taken automatically — nothing executes without human sign-off — but the item skips a redundant Mid-tier escalation, since the Small-tier model's confidence is already high.

**Medium confidence (70–90%):** Auto-escalates to the Mid-tier model for the Filler-tier contextual summary before an analyst ever sees it (the same escalation rule already defined in `03-the-margin/cost-curve.md`'s Cascading Strategy), so the analyst gets added context on arrival instead of a bare score.

**Low confidence (<70%):** Surfaced as "needs manual review" with no recommended verdict — the UI shows raw signals instead of a score-driven flag, so an analyst isn't anchored to a number the model itself isn't confident in.

**User control surface:** An analyst can see the confidence score and its contributing flags, adjust the escalation threshold within a governance-approved range, and override any tier's classification with a one-click reason code that feeds the Correction Loop (see `02-the-moat/data-flywheel.md`). Regardless of confidence tier, the Killer-tier dispute template never generates without an explicit approval action — confidence changes how much help a human gets, never whether they're in the loop for that step.

## Reliability Contract

| Metric | Target | Measurement | Alert Threshold |
|--------|--------|-------------|-----------------|
| Accuracy (Leader-tier score) | ≥ 92% agreement with analyst-confirmed outcome | Weekly sample of 100 scored transactions, checked against confirmed fraud/not-fraud outcome once resolved | Weekly agreement < 88% |
| Hallucination rate (Filler + Killer output) | < 1% of generated summaries/templates contain a claim not traceable to source transaction data | LLM-as-judge audit on a 5% random sample, plus 100% audit of anything an analyst flags as inaccurate | Audited rate > 2% in any week, or any unsupported claim reaches a Killer-tier document without being caught before send |
| Latency (p95) | Leader scan < 2s · Filler summary < 6s · Killer draft < 15s | Continuous per-call instrumentation, aggregated per tier per day | p95 exceeds target by >50% for 2 consecutive hours |
| Drift velocity | < 5% week-over-week shift in score distribution on a stable transaction mix | Weekly comparison against a fixed reference transaction set, unaffected by real mix changes | Shift > 8% in one week, or the same direction 3 weeks running |

## HITL Architecture
<!-- When does a human step in? What's the escalation path? -->

Three gates, matching the tiers above:

1. **Small tier (Leader):** scores every transaction automatically — no human involved; this is the point of the tool.
2. **Mid tier (Filler):** any transaction crossing the risk threshold auto-escalates for a contextual summary, then lands in the analyst's approval queue. A human always reviews before anything further happens.
3. **Frontier tier (Killer):** the hard gate. The dispute template never generates without an explicit analyst approval action — not passive review, an affirmative decision — mirroring the approval-queue pattern already built into the Orchestrator prototype's workflow timeline.

**Disagreement path:** if an analyst overrides a Leader-tier score, the override is logged as a Correction Loop signal. If the override reverses a High-risk flag specifically, it routes to a second reviewer — a check on the human side, not just the model side.

## Red-Team Findings
*What failure mode did your partner find that you missed?*

<!-- DRAFT — replace with your actual finding if you've run this red-team session. -->
Row 5 above is the sharpest illustration of the failure mode this contract is designed to catch: a model that produces a fluent, confident, well-formatted dispute letter asserting something the underlying data doesn't support, rather than recognizing the contradiction and stopping short of the Killer-tier gate.
