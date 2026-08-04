# Compounding System Design

## Feedback Loops

| Loop | Input | Output | Compounds? | Status |
|------|-------|--------|-----------|--------|
| Recursive Learning | Transaction data from true positives and false negatives | Feeds into monthly model retraining | Y | active |
| Cross-Domain Transfer | Transaction data from true positives | Updates anti-money-laundering models | Y | missing |
| Network Intelligence | Customer reports in customer service | Updates the golden dataset | N | missing |

**Broken loop identified by partner:** Network Intelligence — it's the only loop marked `Compounds: N`, and Context Connectivity below explains why: customer-service chats never reach the training data, so this loop dead-ends at the golden dataset instead of feeding back into Recursive Learning like everything else does.

**Fix plan:** Route customer-service dispute reports into the same training pipeline that Recursive Learning already reads from, not just the golden dataset. Once a customer report resolves (confirmed fraud or confirmed false positive), log it as a labeled example the same way a transaction-level true/false positive is logged today — that's the one change that flips this loop from a one-way archive into something that compounds.

## Context Connectivity
<!-- How does knowledge flow across teams and domains? Where does it silo? -->

**How knowledge flows:** True positives update training data, which is used for multiple fraud models across the bank (Recursive Learning feeds the primary scoring model; Cross-Domain Transfer, once built, would feed anti-money-laundering models from the same signal).

**Where it silos:** Customer service chats don't get into the training data — the Network Intelligence loop above is the direct consequence of this silo, not a separate problem.

## Governance Policy

**Scope:** AI detection of potential scams and fraudulent transactions during the customer transaction flow. Excludes: post-transaction analysis and anti-financial-crime monitoring.

**Autonomy boundaries:**
- OK solo: Leader-tier (Small model) scoring runs on every transaction fully autonomously — it's advisory-only, produces a score and flags, and never acts on them.
- Needs human: anything that leaves the system or triggers an action beyond scoring. The Filler-tier summary generates automatically but is advisory-only, for an analyst's eyes. The Killer-tier dispute template requires an explicit analyst approval to generate, and a second explicit approval to send — nothing in the Killer tier is ever a single-click autonomous action.

**Escalation triggers:** When humans must enter —
- A transaction crosses the risk threshold (see Cascading Strategy, `03-the-margin/cost-curve.md`): auto-escalates to Mid tier and lands in the analyst approval queue.
- An analyst override reverses a High-risk flag: routes to a second reviewer (see HITL Architecture, `04-the-contract/golden-dataset.md`).
- Any Reliability Contract alert threshold breaches (hallucination rate, drift velocity, accuracy) — routes to the compliance/audit owner, not just the analyst queue.

**Audit cadence:** Real-time audit-trail logging on every action (matches the Orchestrator's existing audit-trail pattern), weekly reliability sampling (matches the Accuracy and Hallucination-rate measurement cadence in the Reliability Contract), quarterly Shadow AI Audit review (see below).

**Regulatory exposure (EU AI Act / GDPR / sector):**
- Regimes that apply: EU AI Act, GDPR (transaction and customer data is personal data), sector-specific financial-crime regulation (e.g. AML/BSA-equivalent obligations depending on jurisdiction).
- Risk tier: Limited, tentatively — fraud-detection systems are carved out of the EU AI Act's high-risk credit-scoring category (Annex III), but the Killer-tier dispute-template generator produces external-facing content, which may separately trigger AI-generated-content transparency obligations. GDPR applies regardless of the AI Act risk tier, given personal transaction data is in scope. **This read isn't legal advice — get counsel to confirm the exemption holds before relying on it in production**, especially once the dispute-letter feature is live.

## Agent Topology
<!-- If using agents: what can each agent do? What can't it do? Who approves what? -->

| Agent | Tier | Can | Can't | Approval needed |
|-------|------|-----|-------|-----------------|
| Scanning Agent | Small (Leader) | Score every transaction for scam likelihood, apply flags | Contact customers, generate documents, take any action beyond scoring | None — fully autonomous, advisory score only |
| Context Agent | Mid (Filler) | Pull related account/merchant history, draft a contextual summary | Alter the risk score, initiate a dispute, send anything externally | None to generate; output is advisory-only for the analyst |
| Dispute Agent | Frontier (Killer) | Draft a dispute-letter template once triggered | Generate without a trigger, or send without a second confirmation | Explicit analyst approval to generate, separate approval to send |
| Compliance/Audit Agent | cross-cutting | Log every action to the audit trail, monitor drift/hallucination against Reliability Contract thresholds, flag High-risk overrides | Override an analyst's decision or block an action unilaterally | N/A — flags, doesn't decide |

## Shadow AI Audit
<!-- DRAFT — illustrative until you run the actual audit; replace with what's really out there. -->

| Tool | Owner | Risk Level | Decision |
|------|-------|-----------|----------|
| Personal ChatGPT accounts used by analysts to draft dispute letters by hand | Fraud Ops (unmanaged) | H | kill — replace with the governed Dispute Agent flow; real customer PII is being pasted into an ungoverned consumer tool today |
| Legacy rules-based fraud scoring vendor (pre-Orchestrator) | Fraud Ops | M | govern — keep running in parallel during rollout as a fallback/comparison baseline, bring under the same audit logging |
| Spreadsheet macro analysts use to track prior disputes manually | Individual analysts (informal) | L | govern — migrate what it holds into the golden dataset / Network Intelligence loop instead of leaving it siloed on someone's laptop |

**Total tools found:** 3 (illustrative — run the real audit before treating this as complete)
**Tools after triage:** 2 governed, 1 killed
**Estimated hidden spend:** Low in direct license cost (personal LLM accounts are typically free or individually expensed), but the real cost is uncontrolled PII exposure and inconsistent audit coverage, not a subscription line item.
