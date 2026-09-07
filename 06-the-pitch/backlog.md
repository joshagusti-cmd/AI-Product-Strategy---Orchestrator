# Roadmap Backlog

Input to the Horizon mapping in `roadmap.md`. Constructed from `feature-ideas.md` plus every open item flagged across Modules 1–5, in the Summary/Type/Priority/Status/Component/Labels shape the Roadmap Builder tool expects (Product School AIPSC M6). Components map to the five README sections: The Bet, The Moat, The Margin, The Contract, The Guardrails.

| Summary | Type | Priority | Status | Component | Labels |
|---|---|---|---|---|---|
| Replace simulated agent runs with real model API calls | Epic | P0 | Done (prototype) | The Contract | platform, core |
| Persistent backend (prototype is stateless today) | Epic | P0 | Done (prototype) | The Contract | platform, core |
| Design-partner pilot with 1–2 fraud desks | Epic | P0 | Planned | The Bet | gtm, pilot |
| Close the Network Intelligence feedback loop | Task | P0 | Planned | The Moat | data-flywheel |
| Fix Domain Context Loop scoring inconsistency | Bug | P1 | Planned | The Moat | data-quality |
| Verify kill-switch failover with a live drill | Task | P1 | Planned | The Moat | reliability, ops |
| Validate pricing model with real buyer conversations | Task | P0 | Planned | The Margin | pricing, research |
| Run a real Shadow AI Audit (replace illustrative placeholder) | Task | P1 | Planned | The Guardrails | governance, audit |
| Ship Killer-tier dispute generator to production (two-gate approval live) | Epic | P0 | Backlog | The Contract | core, hitl |
| Build Cross-Domain Transfer loop into AML scoring | Epic | P1 | Backlog | The Moat | data-flywheel, expansion |
| Formal EU AI Act / GDPR legal review | Task | P0 | Backlog | The Guardrails | compliance, legal |
| Model break-even economics (CAC + fixed opex) | Task | P0 | Backlog | The Margin | finance |
| Run a real red-team session with a partner | Task | P0 | Backlog | The Contract | reliability, research |
| Real auth + multi-tenancy (SSO/RBAC) | Epic | P1 | Done (prototype) — magic-link auth + per-user isolated workspace shipped, plus real teams/invites (a member invites a teammate by email, they join automatically, multi-workspace users get a switcher); SSO and RBAC within a workspace still open | The Guardrails | platform, security |
| Per-workspace spend caps / rate limiting on real model calls | Story | P1 | Done (prototype) — rolling-24h Orchestrate cap enforced server-side per workspace; plan-tied limits and an admin UI to change one still open | The Guardrails | platform, security, cost |
| True multi-agent orchestration (independent calls per agent, not one call for all six) | Epic | P1 | Done (prototype) — six real, independent, sequential Claude calls with real per-agent context handoff and real per-agent model routing (see next row); multi-provider support still open | The Contract | platform, core |
| Cost-based *automatic* model routing (platform chooses model by task risk/complexity) | Epic | P1 | Backlog — manual per-agent routing shipped (the Command Center's model dropdown drives real per-call routing); automatic cascade-by-risk still open | The Margin | cost, routing |
| Integrations catalog (NetSuite/Salesforce/Zendesk/Snowflake/Workday) | Epic | P1 | Backlog | The Bet | integration |
| Org-wide model spend dashboard | Story | P2 | Backlog | The Margin | analytics, cost |
| Policy editor for compliance owners | Story | P2 | Backlog | The Guardrails | governance, ux |
| Slack/Teams-native approval actions | Story | P1 | Backlog | The Guardrails | integration, hitl |
| Expand into a second department vertical | Epic | P3 | Backlog | The Bet | expansion, gtm |
| Per-department drill-down analytics | Story | P2 | Backlog | The Bet | ux, analytics |
| Workflow history / versioned deliverable archive | Story | P2 | Backlog | The Bet | ux, audit |
| Natural-language audit trail Q&A | Story | P3 | Backlog | The Contract | ux, ai-feature |
| Mobile companion approvals view | Story | P3 | Backlog | The Guardrails | mobile, hitl |
| Saved objective templates | Task | P3 | Backlog | The Bet | ux |
| In-product kill-switch / vendor-portability messaging | Task | P3 | Backlog | The Moat | positioning, ux |

**Unmapped items:** none — every backlog item landed in a horizon. If that changes as the real backlog grows, an item that doesn't fit any of the five components cleanly is itself a signal (either it's out of scope, or it's revealing a strategy gap the current modules don't cover).

See `roadmap.md` for the curated Horizon 1/2/3 tables this backlog rolls up into.
