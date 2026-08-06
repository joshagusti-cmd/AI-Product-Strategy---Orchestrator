# Three-Horizon Roadmap & Board Pitch

## Roadmap

### Horizon 1 — Now (0-3 months)
*Quick wins. Ship with existing capabilities.*

| Initiative | Metric | Confidence |
|-----------|--------|-----------|
| Pilot the Leader-tier scan + Filler-tier summary flow with 1–2 design-partner fraud desks | ≥92% score accuracy in production, matching the Reliability Contract target (`04-the-contract/golden-dataset.md`) | H |
| Close the Network Intelligence feedback loop — route customer-service reports into the same training pipeline Recursive Learning already uses | Loop status flips missing → active; Total Flywheel Score rises from 18/20 | M |
| Move kill-switch readiness from architecture to a verified drill | Confirmed <48h secondary-provider swap under real load, not just on paper | H |

### Horizon 2 — Next (3-9 months)
*Bets. Requires new capabilities or integrations.*

| Initiative | Metric | Confidence |
|-----------|--------|-----------|
| Ship the Killer-tier dispute-template generator to production with the two-gate approval flow live | Sustained <1% hallucination rate at ~8 drafts/user/month, per the modeled Killer-tier volume | M |
| Build the Cross-Domain Transfer loop — extend Leader-tier scam-likelihood signal into anti-money-laundering scoring | Loop status flips missing → active; a second production use case running off the same signal | M |
| Formal legal review of the EU AI Act / GDPR risk-tier read drafted in Module 5, ahead of any EU design partner | Signed-off classification replacing the current draft caveat | H |

### Horizon 3 — Bet (9-18 months)
*Moonshots. High uncertainty, high potential.*

| Initiative | Metric | Confidence |
|-----------|--------|-----------|
| Expand the orchestration layer beyond the fraud/dispute wedge into a second department vertical (e.g. the Customer Success churn-signal capability from the original Orchestrator concept) | First paying logo outside the fraud/dispute vertical | L |

## Board Pitch

**Thesis (1 sentence):** Aiven is the independent, model-agnostic orchestration and governance layer enterprises trust to coordinate, approve, and audit every AI agent working across their business.

**The case:**
1. **Why now:** enterprises are deploying agents faster than they can govern them, and every foundation-model provider is racing to ship more agents of its own rather than a neutral layer to coordinate everyone else's.
2. **What's defensible:** switching cost compounds with usage — workflows, approval chains, governance policy, and audit history live in Aiven, not with any one model provider. Vendor portability is rated Ready (`02-the-moat/kill-switch.md`) precisely because none of that moat depends on which model sits underneath.
3. **The economics:** outcome-based pricing tied to the unit of work performed (`03-the-margin/cost-curve.md`) holds gross margin near ~87%, in line with traditional SaaS, and scales with usage instead of eroding under it.

**The risks:**
1. **Trust / failure modes:** a model producing a fluent, confident, wrong output — a dispute letter asserting something the data doesn't support — is the core failure mode identified in Module 4's red-team finding. Mitigated by requiring an explicit human gate before anything irreversible ships, never by trusting the model's confidence score alone.
2. **Scale / governance:** two of four flywheel loops (Cross-Domain Transfer, Network Intelligence) are still marked "missing," not "active" (`02-the-moat/data-flywheel.md`) — the moat is real on paper but not yet fully built in practice.
3. **Competitive:** Microsoft's Copilot Studio bundling is rated as putting 65% of value at risk within six months — the single biggest named threat in the encroachment assessment, and the clock that matters most for Horizon 1.

**The ask:** design-partner budget plus engineering capacity to close the two missing flywheel loops and take the Killer-tier flow from prototype to production before a well-resourced incumbent bundles equivalent governance into a footprint enterprises already have installed.

## M1 Baseline vs. Now
*Your 3-sentence AI strategy from Module 1 vs. what you'd say now:*

**M1 baseline:** A multi-agent enterprise orchestration platform that lets organizations deploy, govern, monitor, and continuously optimize AI agents across every business function — HR, Finance, Legal, Sales, Marketing, Operations, Product, and Customer Success — from a single operating layer. Instead of replacing Claude or GPT, it orchestrates them. The platform becomes the independent operating layer sitting above every foundation model an enterprise chooses to use.

**Now:** The first real product surface is narrower than the original enterprise-wide pitch: a governed transaction-scanning, contextual-summary, and dispute-template workflow built for bank and fintech fraud desks, priced per transaction scanned. The moat thesis is holding up in practice — vendor portability tests out as Ready, and the packaging (Leader/Filler/Killer) gives margin protection a real mechanism instead of a slogan — but two of the four flywheel loops are still unbuilt, and 65% of addressable value sits exposed to a Microsoft bundling move inside six months. The bet hasn't changed; the path to it starts as one vertical wedge proven end-to-end, not a simultaneous rollout across every department at once.
