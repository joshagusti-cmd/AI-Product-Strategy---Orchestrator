# Aiven Orchestrator — Walkthrough

This is an onboarding path, not a reference. It walks a new user through the console in the order you'd actually touch it — sign in, set up your workspace, run something, learn what happens when it pauses, then work through the pages that govern, audit, and report on what ran. For "what does this exact button/field do," see the page-by-page [`USER_GUIDE.md`](USER_GUIDE.md) — this doc links out to it rather than repeating it. For the product framing (what's real vs. still-modeled/simulated), see the root [`README.md`](../../README.md) and [`01-the-bet/prototype.md`](../prototype.md).

Everything below is real and live — real Supabase Postgres, real auth, real Claude API calls, real policy enforcement — not a mockup, except where a section says otherwise.

---

## 0. Before you start

Two workspaces exist wherever you open the app:

- **The public demo** — what you see before signing in. Shared, read-only. You can click through every page, but nothing that changes data works (no Orchestrate, no saving a policy, no deciding an approval).
- **Your own workspace** — created automatically the first time you sign in, private to you and whoever you invite into it. Everything from here on describes your own workspace.

---

## 1. Signing in and finding your role

1. Click the auth widget in the top bar of any page and enter your email.
2. You'll get a magic link — no password. Click it, and you're in.
3. The first sign-in auto-provisions a private workspace for you, pre-seeded with a starting agent roster and policy set.

You'll have one of three roles in that workspace:

| Role | Can do |
|---|---|
| **Admin** | Everything below, plus: reassign agent models, manage the team (invite/remove/change roles), change the plan, and everything in **Section 2 (Admin setup)** below. |
| **Compliance Owner** | Edit policies, decide Shadow AI findings (govern/kill). Admins can also do both. |
| **Analyst** | Run Orchestrate, approve/reject requests, run a Shadow AI scan, ask the audit trail a question. |

A control you can't use for your role is disabled in the UI — and rejected server-side too if you somehow tried to force it, so this isn't cosmetic.

If you belong to more than one workspace (someone invited you elsewhere), a switcher appears near the auth widget so you can pick which one is active.

**On a phone.** The subnav scrolls horizontally and auto-scrolls the current tab into view — you're never dropped somewhere off-screen. The Approval Queue also has a dedicated mobile view; see Section 8.

---

## 2. Admin setup

Skip this section if you're not an Admin — an Analyst or Compliance Owner can jump to Section 3. Everything here lives in the **Workspace modal**, opened from the auth widget.

### Invite your team

Open **Workspace → Team**, enter a teammate's email, pick their role (Admin / Compliance Owner / Analyst), and send it. They join automatically the next time they sign in with that email — there's no accept step. Not yet built: a member leaving on their own, or changing their own role (an Admin can still change it for them).

### Plan and caps

Every workspace has a plan — **Free, Pro, or Enterprise** — that sets two real, enforced limits at once:

- Orchestrate runs per rolling 24 hours: 20 / 100 / 500
- Real dollars spent per rolling 24 hours: $5 / $25 / $150, priced at real Anthropic rates

Either cap alone can stop a fresh run — the dollar cap exists because a handful of unusually complex objectives can burn real budget a run-count cap wouldn't catch. Change the plan from **Workspace → Plan**. There's no real billing behind this yet: changing the plan just changes the enforced numbers, nothing is charged.

### Emergency Stop

**Workspace → Emergency Stop** is a real, one-switch kill for a real incident — bigger and blunter than disabling a single agent in the Agent Registry. Flip it on and every new Orchestrate run, every paused-run resume, and every external agent's approval check freezes workspace-wide until an Admin flips it off. Every member sees whether it's active and who activated it.

The one honest limit: it's real for everything Aiven itself runs, but it can't reach into an external agent's own code that never checks in first (see Section 6).

### Provider Keys (bring your own OpenAI/Google key)

By default, picking "GPT-4o" or "Gemini 1.5 Pro" anywhere in the console silently falls back to that agent's Claude default — the Shadow AI Audit is built to catch exactly this kind of drift. To make those providers genuinely real for your workspace, paste your own OpenAI or Google API key into **Workspace → Provider Keys**. It's encrypted at rest and never shown again — only its last 4 characters, so you can confirm which key is connected. The moment it's saved, that provider's models are real calls, not substitutions, and the Shadow AI Audit stops flagging that provider as drift. **Remove** deletes the key for good and reverts to the Claude fallback.

Aiven itself holds no platform-wide OpenAI/Google credential — this is real routing exactly for workspaces that bring their own key. You can see this reflected live in the Anthropic/OpenAI/Google chips next to the logo on every page — hover one for the real reason behind its state.

### Webhook notifications

**Workspace → Webhook Notifications** takes a plain URL — Slack's or Teams' own incoming-webhook URL works, or any generic endpoint that accepts a POST. The moment a run actually pauses for approval, Aiven POSTs a real JSON payload (workspace name, objective, risk severity/text, approval id, timestamp) to it. Every attempt is logged and shown as "last delivery: succeeded/failed, N ago." Scope today: only a run pausing fires it — there's no "send test webhook" button yet (a client-side test would run into CORS most endpoints don't handle).

### Data retention

**Workspace → Data Retention** sets an auto-delete window (30/90/180/365 days, or "No automatic deletion," the default) for Audit Trail and Workflow History rows. It's enforced two ways: automatically once a day, and, if you want proof right now, a **Run retention now** button that deletes for real, immediately, and tells you how many rows it removed. This can't be undone, and it's scoped exactly to Audit Trail and Workflow History — not (yet) spend telemetry or the audit trail Q&A history.

---

## 3. Running your first Orchestrate

This is the Command Center (`index.html`), the page you'll use most.

1. **Enter a business objective** — the thing you want analyzed, e.g. "Assess our Q3 vendor risk exposure and recommend next steps."
2. **Pick departments and data sources** in scope using the chips.
3. **Choose routing.** Leave **Auto-route models by risk/complexity** on (default) and the system picks each agent's model itself — a deterministic cascade that escalates to a more capable model when your objective's text matches governance/risk keywords or the scope is large. Turn it off to assign each agent's model yourself from the per-agent dropdowns.
4. Click **Orchestrate**.

What happens is six independent, real Claude API calls in sequence — Research, Finance, Operations, Risk & Compliance, Strategy, Executive Writer — each one actually reading the prior agents' real output. Watch the timeline light up as each step completes.

**Before your objective is ever sent**, two guardrails run automatically:
- **Redaction** — a pattern-match pass masks SSNs, emails, phone numbers, credit-card numbers, and API-key-shaped strings (e.g. `[REDACTED:EMAIL]`) in your objective and in every agent's output before it's stored or shown. A toast tells you what was masked, and it's logged to the Audit Trail. This catches obviously-shaped values, not arbitrary PII buried in prose.
- **Prompt-injection screening** — text that reads like an attempt to override an agent's instructions or extract its system prompt gets neutralized as `[FLAGGED:PROMPT_INJECTION]`, the rest of your objective still runs, and it's logged as a high-severity Audit Trail entry.

**If the run pauses**, see Section 4 — that's expected, not an error.

**When it finishes**, you get an executive summary, key findings, prioritized recommendations, and risk flags — copy it as Markdown or print it. It's also saved automatically to Workflow History (Section 8), so it's not lost once you navigate away.

**Rate limits.** Your plan (Section 2) caps runs per day and real dollars spent per day; the console shows your current usage against both, live.

**Doing this regularly?** Fill in the objective, scope, and routing the way you want, type a name into **Save as template**, and save. It shows up in **Load a saved template**, shared across your whole workspace — pick it and every field, including per-agent model assignments, fills back in instantly, ready to run.

---

## 4. When a run pauses: Policies and gates

A run only pauses because of one policy: the **Core tier** in **Policies** (`policies.html`) — the one policy tier the real pipeline actually checks after the Risk & Compliance Agent's finding. It has three parts: an **autonomy level**, a **risk threshold** (0–100 slider), and an **escalation rule** written in plain language.

Autonomy level controls whether a run ever stops:

- **Autonomous / Advisory** — the flag is shown, but the run always continues automatically. Nothing pauses.
- **Approval-required** — a risk flag scoring at or above the threshold genuinely pauses the run before Strategy/Writer run (their real API cost included) — **gate 1**. A human has to decide before it continues.
- **Two-gate** — gate 1 works the same way, plus a real **gate 2**: every run this policy produces is generated but held out of Workflow History until a second, separate approval releases it — whether or not gate 1 ever fired. You still see your own result immediately in the Command Center; gate 2 governs when the rest of the workspace sees it.

Only Admins and Compliance Owners can edit a policy, and every save is logged to the Audit Trail.

When a gate-1 pause happens, you'll see a real approval waiting in the Command Center's own panel. **Approve** resumes the run for real; **Reject** ends it for real — no deliverable is generated either way. The same decision can also be made from the org-wide **Approval Queue** by anyone else in the workspace (Section 5) — same real effect, different vantage point.

---

## 5. Approval Queue

`approvals.html` is the org-wide backlog of everything waiting on a human — filterable by risk and department. Anyone in the workspace can approve or reject.

Two kinds of rows show up here, and they behave differently:

- **A regular approval** (raised by a paused Orchestrate run, or an external agent — see Section 6) — deciding it either resumes the run's remaining Claude calls (**Approve**) or ends it for good (**Reject**).
- **A release approval**, titled `Release: <objective>` — this is gate 2 under a Two-gate policy. The run already finished and generated its deliverable; there's nothing left to resume. **Approve** releases it into Workflow History for the whole workspace; **Reject** keeps it generated but permanently held back from that shared archive.

**Raised by** links straight back to the agent's Agent Registry row whenever the name resolves to a real one.

**On your phone.** Click **Open the mobile companion view** (or go to `mobile-approvals.html`) for a page built for a phone from the ground up — two KPI tiles, a Pending/All toggle, and big Approve/Reject cards. Same live queue, same real decisions.

---

## 6. Agent Registry

`agents.html` is the full roster the orchestrator governs — every department, tier, assigned model, status, and what each agent can/can't do without a human.

- **Claude Sonnet 5** and **Claude Opus 4.8** are always real routing targets. **GPT-4o** and **Gemini 1.5 Pro** become real once your workspace connects its own provider key (Section 2) — otherwise assigning them silently falls back to Claude and tells you so in a toast. That drift is exactly what the Shadow AI Audit (Section 9) is built to catch.
- **Filter** by tier or by department (built from your workspace's real data).
- A **Review** status is clickable exactly when there's a real pending approval raised by that agent — click it to land on that exact Approval Queue row.
- The **Pipeline** column is real control for the six Command Center agents: their real step number, a **Writer**/**Risk gate** tag where it applies, and an Admin-only **Enabled** checkbox that genuinely removes an agent from the next real Orchestrate run without deleting it from the registry.
- **+ Add external agent** connects anything your team already runs elsewhere, any stack. You get a real API key and endpoint shown exactly once — save it immediately. Every POST that agent's own code sends shows up here, in the Audit Trail, and in the Approval Queue if it reports a risk finding crossing your Core policy's threshold, exactly like an internal agent. The one honest limit: Aiven never runs that agent itself, so a gate only works if that agent's own code checks in first and honors the answer.

---

## 7. Audit Trail

`audit.html` is a real-time, searchable log of every agent and human action — approvals, policy saves, orchestrate runs, all land here immediately. Export the current view as JSON or CSV.

**Filter by department** using the chips (built from your real agent roster). **Actor** and **action** cells link back to the Agent Registry row or Approval Queue row they're about, whenever that resolves to something real and still there.

**Ask the audit trail** — type a plain-language question ("why did the Risk & Compliance Agent flag something last week?") and a real Claude call answers it, grounded strictly in your workspace's own most recent 300 log entries. If the log doesn't support an answer, it says so rather than inventing one. Your question/answer history is saved. This has its own rate limit, separate from Orchestrate: 40 questions per rolling 24 hours.

---

## 8. Reporting: Workflow History, Model Spend, Governance Snapshot

Three pages, three different jobs.

### Workflow History (`workflow-history.html`)

A real, searchable archive of every completed run's full deliverable — not just the Audit Trail's one-line pointer. Search or filter by department, click a row to expand the full executive summary, findings, recommendations, risk flags, and every agent step.

- **Full prompt visibility.** Each agent step has a **View prompt** toggle showing the exact system/user prompt that agent's real Claude call received. Runs archived before this shipped simply have no toggle.
- **Pending release.** A run under a Two-gate policy shows a **Pending release** badge and stays hidden here until its release approval is decided (Section 5). The **Pending release** KPI tile counts what's waiting on you right now, and the placeholder's link goes straight to that run's own release approval.
- **Comparing two runs.** Check any two rows, click **Compare selected**, and see both full deliverables side by side. It's a real juxtaposition — nothing is computed as "changed," you're looking at both in full.

### Model Spend Dashboard (`spend.html`)

Two things, deliberately kept separate:

- **Cost by tier / by model provider** — a modeled projection tied to the Leader/Filler/Killer pricing strategy. Illustrative, not billed.
- **Real Orchestrate spend** — every real Claude call your workspace has actually made, priced at real, current Anthropic rates, broken down by model and by agent. Measured, not modeled. The **"Today's spend / real cap"** tile shows the same rolling-24h figure the backend actually enforces against your plan's dollar cap (Section 2).

### Governance Snapshot (`governance-snapshot.html`)

A single-document bundle of your workspace's real governance state — current policies, the approval record, the audit trail — formatted for an actual auditor or customer security review, not a raw data dump. Pick a range (30/90/365 days, or all time) to scope the Approval Record and Audit Trail sections; Governance Policies is always current, since a policy is a live setting. Signed-in users also get a plan/emergency-stop/retention/spend posture strip at the top.

- **Print / Save as PDF** opens your browser's real print dialog with the console chrome stripped — a genuine document, not a screenshot.
- **Copy as Markdown** copies the same content as plain text, for pasting into an email or doc.

---

## 9. Shadow AI Audit

`shadow-ai.html` shows a list of illustrative historical findings as backdrop — narrative from the original governance case study, not something a scan produced. **Run Shadow AI Scan** is real, though, and checks three things in your own workspace's real data:

1. Does any of the six Command Center agents' assigned model (Agent Registry) not match a model this workspace can actually call — factoring in a connected provider key? Real registry drift.
2. Has a real Orchestrate run actually requested an ungoverned model and gotten silently substituted? A real, repeated request for something not really governed.
3. Has a single real call's token usage spiked sharply above that agent's own rolling average? A real, deterministic 3-sigma statistical check — not trained ML — that needs at least 5 prior calls before it trusts a baseline, so a brand-new workspace correctly shows nothing here yet.

Every finding lands in the same queue, waiting on an Admin or Compliance Owner to **Govern** (log it, accept as known — no other state changes) or **Kill** (flag it as needing real action — fix the registry, or dig into what an anomalous run actually asked for; Kill doesn't automatically fix anything by itself).

What this can't do: detect outside tool use — a personal ChatGPT account, an unsanctioned browser extension — since nothing about those ever touches this app. That needs real endpoint/CASB integration at a real customer.

---

## 10. Resetting demo data

Every page has a **Reset demo data** link in the footer. It only resets the shared **public demo workspace** — your own signed-in workspace is never touched.

---

## Troubleshooting

See [`USER_GUIDE.md`](USER_GUIDE.md#troubleshooting) for the current list of known messages and what they mean — it's kept current there rather than duplicated here.

---

## Where to go next

- **Page-by-page reference, every field explained:** [`USER_GUIDE.md`](USER_GUIDE.md)
- **What's real vs. still modeled/simulated across the whole product:** [`01-the-bet/prototype.md`](../prototype.md)
- **Product strategy and pitch:** the root [`README.md`](../../README.md)

Video walkthroughs of this same path are planned as a later phase — not part of this doc.
