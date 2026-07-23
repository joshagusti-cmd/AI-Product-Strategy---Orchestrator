# Kill Switch Audit

## Vendor Dependency Assessment

| Dimension | Current State | Risk Level | 48-Hour Action |
|-----------|--------------|------------|---------------|
| **Provider** | Depends on external foundation model providers (OpenAI, Anthropic, Google Gemini, Azure OpenAI, Amazon Bedrock, local/open-source models); no single provider should own customer workflows | M | Enable secondary production providers; keep API credentials active across providers; maintain identical prompt libraries; document failover procedures; continuously monitor provider health and pricing |
| **Abstraction** | Business logic never calls OpenAI, Claude, Gemini, or any model directly - every request passes through the Aiven Orchestration Layer, so adding a provider only requires a new adapter | L | Maintain a standardized provider interface; keep adapters independently versioned; validate every new provider against the common interface; keep provider-specific logic out of business workflows |
| **Routing** | Requests are dynamically routed by cost, latency, model capability, reliability, customer policy, regulatory/geographic requirements, context window, and task complexity, so customers never manually switch providers | L | Enable dynamic routing policies; maintain provider health monitoring; configure automatic failover; continuously benchmark routing decisions |
| **Eval** | Every provider replacement must pass automated evaluation (accuracy, hallucination rate, consistency, business KPIs, cost, latency, safety, policy compliance, human approval) before production rollout | M | Maintain benchmark datasets; run automated regression tests across providers; compare business outcomes, not just model outputs; approve provider changes only after evaluation passes |

## Portability Score
Ready - estimated provider swap time is 24-48 hours. The architecture supports replacing foundation models without changing application code, customer workflows, or governance policies. The main remaining dependency is keeping automated evaluation pipelines that confirm a replacement provider hits equivalent business outcomes before traffic shifts.

## If [primary vendor] doubles pricing tomorrow:
Within 48 hours, enable an already-configured secondary provider, redirect traffic through that provider's orchestration adapter, and validate it against benchmark evaluations before shifting production traffic - no application code or customer-facing workflow changes required.

## If [primary vendor] ships a competing product:
Aiven's advantage isn't the intelligence of any single model - it's orchestrating people, agents, workflows, governance, and business outcomes across every model an enterprise chooses to use, which a single-model competitor can't replicate.
