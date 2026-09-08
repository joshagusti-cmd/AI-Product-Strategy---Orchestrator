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
| Run a real Shadow AI Audit (replace illustrative placeholder) | Task | P1 | Planned — the prototype's scan mechanism itself is now real (Done: `shadow-ai.html` scans real Agent Registry drift + real Orchestrate substitution telemetry, not fictional findings); a real audit of outside tool use still needs a real design partner + endpoint/CASB integration, which is this row's remaining scope | The Guardrails | governance, audit |
| Ship Killer-tier dispute generator to production (two-gate approval live) | Epic | P0 | Backlog | The Contract | core, hitl |
| Build Cross-Domain Transfer loop into AML scoring | Epic | P1 | Backlog | The Moat | data-flywheel, expansion |
| Formal EU AI Act / GDPR legal review | Task | P0 | Backlog | The Guardrails | compliance, legal |
| Model break-even economics (CAC + fixed opex) | Task | P0 | Backlog | The Margin | finance |
| Run a real red-team session with a partner | Task | P0 | Backlog | The Contract | reliability, research |
| Real auth + multi-tenancy (SSO/RBAC) | Epic | P1 | Done (prototype) — magic-link auth + per-user isolated workspace shipped, plus real teams/invites (a member invites a teammate by email with a chosen role, they join automatically, multi-workspace users get a switcher) and real RBAC within a workspace (Admin/Compliance Owner/Analyst, enforced by RLS); SSO still open | The Guardrails | platform, security |
| Per-workspace spend caps / rate limiting on real model calls | Story | P1 | Done (prototype) — rolling-24h Orchestrate cap enforced server-side per workspace, now tied to a real plan tier (Free/Pro/Enterprise → 20/100/500) changeable by an admin; real billing/payment behind the plan still open | The Guardrails | platform, security, cost |
| True multi-agent orchestration (independent calls per agent, not one call for all six) | Epic | P1 | Done (prototype) — six real, independent, sequential Claude calls with real per-agent context handoff and real per-agent model routing (see next row); multi-provider support still open | The Contract | platform, core |
| Cost-based *automatic* model routing (platform chooses model by task risk/complexity) | Epic | P1 | Done (prototype) — a real, deterministic three-tier cascade (risk keywords + scope size) picks each agent's model when the Command Center's Auto-route toggle is on, escalating to Opus 4.8 only where warranted; a trained/scored risk model and true multi-provider routing still open | The Margin | cost, routing |
| Integrations catalog (NetSuite/Salesforce/Zendesk/Snowflake/Workday) | Epic | P1 | Backlog | The Bet | integration |
| Org-wide model spend dashboard | Story | P2 | Done (prototype) — `spend.html` built at prototype fidelity; now also shows real, measured Orchestrate spend (real model + token usage per call, priced at real Anthropic rates), not just the modeled Leader/Filler/Killer cost-curve numbers | The Margin | analytics, cost |
| Policy editor for compliance owners | Story | P2 | Done (prototype) — `policies.html` built at prototype fidelity; its Core-tier policy now really gates the Orchestrate pipeline (Approval-required/Two-gate genuinely pauses a run until a human decides), not just a UI-only editor with no consumer | The Guardrails | governance, ux |
| Slack/Teams-native approval actions | Story | P1 | Backlog | The Guardrails | integration, hitl |
| Expand into a second department vertical | Epic | P3 | Backlog | The Bet | expansion, gtm |
| Per-department drill-down analytics | Story | P2 | Done (prototype) — real department filter on Agent Registry, Approval Queue, and Workflow History, built from each page's own real data; Audit Trail/Spend/Shadow AI have no clean department field to extend it to yet | The Bet | ux, analytics |
| Workflow history / versioned deliverable archive | Story | P2 | Done (prototype) — `workflow-history.html` archives every completed Orchestrate run's full real deliverable (`orchestrate_runs`), searchable and reopenable; checking two runs and clicking "Compare selected" now shows both full deliverables side by side, real data juxtaposed, not a computed diff | The Bet | ux, audit |
| Natural-language audit trail Q&A | Story | P3 | Done (prototype) — `audit.html`'s "Ask the audit trail" panel is a real Claude call grounded strictly in the workspace's real `audit_log` rows, rate-limited and its Q&A history persisted | The Contract | ux, ai-feature |
| Mobile companion approvals view | Story | P3 | Done (prototype) — `mobile-approvals.html` is a real phone-first page (card rows, big tap targets, a Pending/All toggle) reading a lean dedicated approvals fetch and writing through the same real decide/resume path as the full Approval Queue | The Guardrails | mobile, hitl |
| Saved objective templates | Task | P3 | Done (prototype) — the Command Center can save the current objective, scope, and model routing as a named template (`objective_templates`) and reload it later | The Bet | ux |
| In-product kill-switch / vendor-portability messaging | Task | P3 | Backlog | The Moat | positioning, ux |

**Unmapped items:** none — every backlog item landed in a horizon. If that changes as the real backlog grows, an item that doesn't fit any of the five components cleanly is itself a signal (either it's out of scope, or it's revealing a strategy gap the current modules don't cover).

See `roadmap.md` for the curated Horizon 1/2/3 tables this backlog rolls up into.
