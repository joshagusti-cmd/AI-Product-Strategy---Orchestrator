# Aiven Orchestrator — User Guide

This is a working guide to the Aiven Orchestrator console, kept up to date alongside the build — every feature below is real and live in the product today, not a mockup. If something here doesn't match what you see in the app, the app is right and this doc needs an update.

For the product strategy, pitch, and "what's still simulated" caveats, see the root [`README.md`](../../README.md) and [`01-the-bet/prototype.md`](../prototype.md). This guide is purely "how do I use it," page by page, every feature explained. New here? [`USER_TRAINING.md`](USER_TRAINING.md) (also available in the console itself at [`user-training.html`](user-training.html)) walks the same ground in the order you'd actually use it, setup through reporting, and links back to this guide for detail.

---

## Getting started

**The public demo.** Opening the app without signing in shows a shared, read-only demo workspace — you can look around every page, but Orchestrate, saving a policy, deciding an approval, and everything else that changes data is disabled.

**Signing in.** Click the auth widget in the top bar and enter your email. You'll get a magic link — no password to set or remember. The first time you sign in, a private workspace is created for you automatically, pre-seeded with a starting agent roster and policy set. Everything you do from then on — orchestrating a run, saving a policy, deciding an approval — is scoped to your own workspace, invisible to anyone outside it.

**Your role.** Every workspace member has one of three roles:
- **Admin** — reassigns agent models, manages the team (invite/remove/change roles), changes the plan.
- **Compliance Owner** — edits policies, decides Shadow AI findings (govern/kill). Admins can do this too.
- **Analyst** — everything else: running Orchestrate, approving/rejecting requests, running a Shadow AI scan, asking the audit trail a question.

Controls you can't use for your role are disabled in the UI, and the same restriction is enforced on the server — hiding a button isn't the security boundary, it's just a courtesy.

**Teams.** Open the **Workspace** modal from the auth widget to invite a teammate by email and pick their role. They join automatically the next time they sign in with that email. If you belong to more than one workspace, a switcher appears so you can pick which one is active.

**Plan & usage.** Every workspace has a plan — Free, Pro, or Enterprise — which sets two real, enforced caps: how many Orchestrate runs it can make per rolling 24 hours (20/100/500) and how many real dollars it can spend per rolling 24 hours ($5/$25/$150, priced at real Anthropic rates) — either cap alone can stop a fresh run. An admin changes the plan from the Workspace modal, which changes both caps together. There's no real billing behind this yet — changing the plan just changes the enforced limits.

**Emergency Stop.** The Workspace modal also has a real, one-switch kill for a real incident — bigger and blunter than disabling one agent in Agent Registry. An admin turns it on and every new Orchestrate run, every paused-run resume, and every external agent's `check_approval` poll (see **Connecting an agent you already run somewhere else** below) is genuinely frozen, workspace-wide, until an admin turns it off. Every member sees whether it's active and who activated it; only an admin can flip it. It's real for everything Aiven itself runs — it can't reach into an external agent's own code that never checks in first, the same honest limit that control always has.

**Webhook notifications.** The Workspace modal also has a Webhook Notifications section: an admin pastes a plain URL (any endpoint that accepts an HTTP POST — Slack's/Teams' own incoming-webhook URLs work, so does a generic one) and every member can see whether it's configured and its last real delivery status. The moment a run actually pauses for approval, Aiven POSTs a real JSON payload (workspace name, the run's objective, the risk flag's severity and text, the approval id, a timestamp) to that URL — nobody has to be actively watching the Approval Queue to find out a run is waiting on them. Every attempt, success or failure, is logged for real and shown as "last delivery: succeeded/failed, N ago" — not a leap of faith that it's working. Scope today: only a run pausing fires a webhook; there's no "send test webhook" button yet (a client-side test would run into CORS the pasted endpoint likely doesn't handle).

**Data retention.** The Workspace modal also has a Data Retention section: an admin can set an auto-delete window (30/90/180/365 days, or "No automatic deletion," which is the default for every workspace) for Audit Trail and Workflow History rows — a real, common GDPR/data-minimization ask. Set a window and it's enforced two real ways: automatically, once a day, and, for anyone who wants proof right now rather than trusting a background job, a **Run retention now** button that deletes for real, immediately, and tells you exactly how many rows it removed. This can't be undone, and it's scoped exactly to Audit Trail and Workflow History — not yet extended to spend telemetry or the audit trail Q&A history.

**Provider Keys (bring your own OpenAI/Google key).** The Workspace modal also has a Provider Keys section: an admin can paste in this workspace's own real OpenAI or Google API key, encrypted at rest and never shown again once saved (only its last 4 characters, so you can tell which key is connected). The moment a key is saved, that provider becomes real for this workspace — picking "GPT-4o" or "Gemini 1.5 Pro" (Command Center or Agent Registry) genuinely calls that provider instead of silently falling back to Claude, and the Shadow AI Audit stops flagging it as drift. Aiven itself holds no platform-wide OpenAI/Google credential — this is real routing exactly for the workspaces that bring their own key, nothing shared across customers. **Remove** deletes the underlying encrypted key for good; that provider's agents fall back to Claude again, same as before it was connected.

**Vendor portability, in the top bar itself.** The Anthropic/OpenAI/Google chips next to the logo on every page aren't decoration — they reflect this signed-in workspace's own real Provider Keys status. Anthropic is always lit (Aiven's own key, no setup); OpenAI/Google light up the moment this workspace connects its own key above, and dim again if it's removed. Hover a chip for the real reason behind its state. It's the same not-locked-to-one-vendor story the pitch makes (`02-the-moat/kill-switch.md`), made visible in the product itself rather than left to a slide.

**Jumping straight to what a reference is about.** Several pages mention an agent or an approval by name in passing — Approval Queue's "Raised by," Shadow AI's "Owner," Model Spend's "By agent," Audit Trail's actor and action columns, Workflow History's "held for a second release approval" note, Agent Registry's "Review" status. Wherever that reference resolves to a real, still-existing row, it's a real link, not just text — click it and you land on the Agent Registry or Approval Queue, scrolled to and highlighting whatever it's about (one exact row for a reference to a single agent or approval; every still-pending request for an agent-wide reference like a Status pill) with a one-time highlight pulse so you're not hunting for it in a long table. A reference that no longer resolves to anything (an agent since removed, an approval from a reset demo) stays plain text rather than pointing at a dead link.

**On a phone screen.** The subnav at the top of every desktop-console page scrolls horizontally once it's wider than your screen, with a fade at whichever edge has more tabs off-screen, and it automatically scrolls the current page's tab into view on load — you're never dropped on a tab that's scrolled out of sight. The Approval Queue also has a dedicated mobile companion view built for a phone from the ground up (see **On your phone**, below) rather than relying on the subnav's own scroll behavior alone.

---

## Command Center (`index.html`)

This is where you run the orchestrator.

1. **Enter a business objective** — the thing you want analyzed (e.g. "Assess our Q3 vendor risk exposure and recommend next steps").
2. **Pick departments and data sources** in scope, using the chips.
3. **Choose routing**: leave **Auto-route models by risk/complexity** on (the default) and the system picks each agent's model itself — a deterministic cascade that escalates to a more capable model when the objective's text matches governance/risk keywords or the scope is large. Turn it off to pick each agent's model yourself from the per-agent dropdowns.
4. Click **Orchestrate**.

What happens next is real: six independent Claude API calls run in sequence — Research, Finance, Operations, Risk & Compliance, Strategy, and the Executive Writer — each one actually reading the prior agents' real output before it runs, not a single call inventing all six. You'll see each step light up in the timeline as it completes.

**If a run pauses.** The Risk & Compliance Agent's finding is checked against your workspace's Core-tier policy (see **Policies** below). If that policy's autonomy is set to Approval-required or Two-gate and the flag crosses its threshold, the run genuinely stops there — the Strategy and Writer steps (and their real API cost) don't happen until a human decides. You'll see a real approval waiting in the panel on the right; **Approve** resumes the run for real, **Reject** ends it for real (no deliverable is ever generated). This can also be approved from the org-wide **Approval Queue** by someone else — either way has the same real effect.

**The deliverable.** Once a run completes, you get an executive summary, key findings, prioritized recommendations, and risk flags — copy it as Markdown or print it. It's also saved automatically to **Workflow History** (see below), so it's not lost once you navigate away.

**Redaction.** Before your objective ever reaches an agent, and before any agent's output is stored or shown to you, a real pass scans for SSNs, email addresses, phone numbers, credit-card numbers, and API-key-shaped strings and masks any it finds — e.g. `[REDACTED:EMAIL]`. If anything gets masked, a toast tells you what and how many; it's also logged to the Audit Trail, so it's a visible finding, never a silent block. This is a real pattern-match guardrail, not a claim of true PII detection — obviously-shaped values are caught, ordinary prose isn't scanned for meaning.

**Prompt-injection screening.** Your objective is also checked, before anything else touches it, for language that reads like an attempt to override an agent's instructions or extract its system prompt — "ignore previous instructions," "reveal your system prompt," chat-template markers, jailbreak framing, and similar. A match is neutralized in place as `[FLAGGED:PROMPT_INJECTION]` and the run still proceeds with the rest of your objective intact — you'll see a toast naming what was flagged, and it's logged to the Audit Trail as a real, high-severity finding. Same honesty as redaction: a real pattern match, not a claim of true intent detection.

**Rate limit.** Your workspace's plan caps how many Orchestrate runs you can make per rolling 24 hours — and, separately, how many real dollars you can spend in that same window, since a handful of unusually complex runs can burn real budget a run-count cap alone wouldn't catch. The console shows your current usage; hitting either cap returns a clear error rather than silently failing. Both figures — runs used and real dollars spent, against both real caps — are also shown live in the Workspace modal and on the Model Spend Dashboard.

**Saved templates.** Running the same kind of analysis on a schedule ("do this every month")? Set up the objective, scope, and routing the way you want, type a name in the **Save as template** box, and click save. A saved template shows up in the **Load a saved template** dropdown — picking one instantly fills in the objective, department/source chips, auto-route toggle, and every per-agent model assignment exactly as you saved them, ready to click Orchestrate. Delete a template from the same dropdown once you no longer need it. Templates are shared across your whole workspace, not just your own login.

**Agent network.** The hub-and-spoke diagram below the objective form is a real, live view of the six-agent pipeline, not decoration — each agent sits on its own ring position with its own endpoint dot (spaced to stay readable and to leave visible room for a future agent, should the pipeline ever grow past six). Click an agent's chip to see its role and reassign its model right there; the same real governance re-evaluation fires as reassigning it from the Agent Registry.

---

## Agent Registry (`agents.html`)

The full roster of agents the orchestrator governs — across every department, not just the six live in the Command Center — with tier, assigned model, status, and what each one can and can't do without a human. Admins can reassign an agent's model here; for the six real Command Center agents, that reassignment actually changes which model runs them on the next Orchestrate call.

**Claude Sonnet 5** and **Claude Opus 4.8** are always real per-call routing targets. **GPT-4o** and **Gemini 1.5 Pro** are real too, for a workspace that's connected its own OpenAI/Google key (see **Provider Keys**, below) — otherwise, or for Claude Haiku 4.5 via manual selection, assigning it doesn't error, the run silently falls back to that agent's Claude default and tells you so in a toast. Either way it means the registry's stated model and the real model running it have drifted apart. The **Shadow AI Audit** (below) is built to catch exactly that — and, once a provider's connected, it stops treating that provider's requests as drift, since they're genuinely real now.

**Filtering.** Filter by tier, or by department — the department chips are built from whatever's actually in your workspace's registry, not a fixed list. Click the **Departments covered** KPI tile to jump straight to the department filter.

**A "Review" status links to the reason it's waiting.** When an agent's Status column shows **Review**, that's clickable exactly when there's a real pending approval raised by that agent — click it and you land on the Approval Queue, scrolled to and highlighting that exact request. A "Review" status with nothing actually pending (mid-pipeline, not blocked on a decision) stays a plain, unlinked pill rather than pointing at nothing.

**The Pipeline column is real control, not just a label.** For the agents that make up the Command Center's real pipeline, this column shows their real step number and, where it applies, a **Writer** or **Risk gate** tag. The **Enabled** checkbox next to it (Admin-only) genuinely removes that agent from the very next real Orchestrate run — it stays in the registry, it just doesn't run until you turn it back on. The Writer and Risk-gate roles can't be disabled here, since the pipeline needs exactly one of each to run at all.

**Connecting an agent you already run somewhere else.** Click **+ Add external agent** for anything your team built outside Aiven — any stack, any language. Give it a name, department, and a one-line description, and you'll get a real API key and a web address (endpoint URL), shown exactly once — save it now, since it can't be shown again (only its regenerate button works after that, which issues a fresh one and immediately invalidates the old). Hand both to whoever runs that agent's own code: every time it POSTs to that address with the key, it shows up right here, in the Audit Trail, and — if it reports a risk finding that crosses your Core policy's threshold — in the Approval Queue too, exactly like an internal agent. Aiven never runs that agent itself, so it can't forcibly pause it; a real gate only works if that agent's own code checks back in before acting and honors the answer, the same honest limit any governance tool has for something it doesn't execute. **Regenerate key** and **Remove** (any member can add or remove; regenerating is Admin-only) sit where the model dropdown would be for an internal agent. If the workspace's **Emergency Stop** (Workspace modal) is active, every risk flag this connector receives is gated regardless of your Core policy's threshold, and every `check_approval` poll answers "not yet" until it's lifted. Every title/detail/risk description it reports also goes through the same real redaction pass as an internal agent's output before it's ever stored.

---

## Policies (`policies.html`)

The compliance-owner control surface: **autonomy level**, **escalation risk threshold**, and an **escalation rule** in plain language, per tier.

The **Core** tier's policy card is marked **"Enforced on real Orchestrate runs"** — because it's not just a label, it's the one policy the Command Center's real pipeline actually checks after every Risk & Compliance Agent finding:

- **Autonomous** / **Advisory** — never pauses a run. The flag is shown, but the run continues automatically.
- **Approval-required** — a real risk flag scoring at or above your set threshold genuinely pauses the run before it can finish (gate 1), waiting on a human decision (see **Command Center** above). Once approved, the deliverable is generated and immediately visible to the whole workspace.
- **Two-gate** — gate 1 works exactly the same way, plus a real second gate: every run this policy produces, whether or not gate 1 ever fired, is generated but held out of Workflow History until a second, separate approval releases it (see **Approval Queue** below). You still see your own result right away in the Command Center — gate 2 governs when it's visible to the rest of the workspace, not whether you can see what you just ran.

The risk threshold is a slider from 0–100; a flag's severity (Low/Medium/High) maps to a fixed score (25/60/90) compared against it. Raise or lower the threshold and you're changing, in real time, whether the next real run pauses at gate 1.

Only Admins and Compliance Owners can edit policies; every save is logged to the Audit Trail.

---

## Approval Queue (`approvals.html`)

The org-wide backlog of everything waiting on a human — filterable by risk and by department. Anyone in the workspace can approve or reject. **Raised by** links back to that agent's real Agent Registry row whenever the name resolves to one. Deciding an approval that came from a paused Orchestrate run has a real, further effect: **Approve** actually resumes that run's remaining Claude calls and produces the deliverable; **Reject** genuinely ends it. This is the same real effect as deciding it from the Command Center's own panel — just from wherever you happen to be reviewing.

**Release approvals** ("Release: <objective>," titled from the Executive Writer Agent) are a distinct real approval type under a **Two-gate** policy — the run already fully generated its deliverable, so there's nothing left to resume. **Approve** releases it into Workflow History for the whole workspace to see; **Reject** keeps it generated but permanently held back from that shared archive.

**On your phone.** Click **Open the mobile companion view** (or go straight to `mobile-approvals.html`) for a page built for a phone screen, not the desktop table shrunk down: two KPI tiles (Pending, High risk pending), a Pending/All toggle, and each request as a card with big Approve/Reject buttons. It's the same live queue and the same real decisions — approving from your phone resumes a paused run exactly like approving from your laptop. It's a companion view, not a tenth page in the main navigation, so you'll always get to it via a link rather than the subnav.

---

## Audit Trail (`audit.html`)

A real-time, searchable log of every agent and human action — approving something, saving a policy, orchestrating a run, all land here immediately. Export the current view as JSON or CSV.

**Filter by department.** The department chips above the log are built from your workspace's own real agent roster, same as Agent Registry, Approval Queue, and Workflow History. An entry is attributed to a department by matching its real actor text against a real agent's name — an entry from "Human reviewer," "Orchestrator Core," or a kill-switch drill isn't a registered agent at all, so it stays real but only shows up under "All," never guessed into a department it wasn't actually part of.

**Actor and action link back to what they're about.** An actor that's a real, still-registered agent name links to its Agent Registry row (this also lights up older entries logged before this shipped, matched by exact name); an action naming a specific approval decision links to that exact row in the Approval Queue. Most entries — "Orchestrator Core," "Human reviewer," a workspace-level redaction or retention event — aren't about one specific agent or approval and stay plain text, which is expected, not a bug.

**Ask the audit trail.** Type a question in plain language — "why did the Risk & Compliance Agent flag something last week?" — and a real Claude call answers it, grounded strictly in your workspace's own real log entries (the 300 most recent). If the log doesn't actually support an answer, it says so plainly rather than making one up. Every question and answer is saved, so your history is still there next time you visit. This is rate-limited separately from Orchestrate — 40 questions per rolling 24 hours per workspace.

---

## Workflow History (`workflow-history.html`)

A real, searchable archive of every completed Orchestrate run's full deliverable — not just the Audit Trail's one-line pointer to it. Search past objectives or filter by department (built from the real department scope each run actually used), then click a row to expand its executive summary, findings, recommendations, risk flags, and every agent's individual step, exactly as it looked when the run finished. Runs that paused for a policy approval and were later resumed are marked so.

**Full prompt visibility.** Each agent step now has a **View prompt** toggle showing the exact system and user prompt that agent's real Claude call actually received — the real inputs behind its response, not just the response itself. Runs archived before this shipped simply have no toggle (an honest gap, not a backfilled guess).

**Pending release.** A run generated under a **Two-gate** policy (Policies above) shows a **Pending release** badge and its deliverable stays hidden here — a real "Generated, but held for a second release approval" placeholder — until someone decides its release approval in the Approval Queue. The **Pending release** KPI tile counts how many are waiting on you right now. The placeholder's **Approval Queue** link goes straight to that run's own release approval, not just the queue's front page — you land already scrolled to and highlighting the exact request this run is waiting on.

**Comparing two runs.** Check the box on any two rows (checking a third does nothing until you uncheck one) and click **Compare selected** to see both full deliverables side by side — objective, scope, model, executive summary, findings, recommendations, risk flags, every agent step. It's a real juxtaposition of two real archived runs, not a computed diff — nothing is highlighted as "changed," you're just looking at both in full at once. Click **← Back to archive** to return to the list.

---

## Model Spend Dashboard (`spend.html`)

Two things live here, deliberately kept separate:

- **Cost by tier / by model provider** — a modeled projection tied to the cascading Leader/Filler/Killer pricing strategy from the business case. Illustrative, not billed.
- **Real Orchestrate spend** — every real Claude call your workspace has actually made, priced at real, current Anthropic per-model rates, broken down by model and by agent. This is measured, not modeled — it comes straight from what actually ran. A **"Today's spend / real cap"** tile shows the same rolling-24h figure the Edge Function actually enforces against your plan's real dollar cap — not a separate estimate. Each row in the **by agent** breakdown links straight to that agent's Agent Registry row.

---

## Shadow AI Audit (`shadow-ai.html`)

A list of historical illustrative findings sits here as backdrop (a legacy scoring vendor, a spreadsheet macro, unmanaged personal tool use) — narrative from the original governance case study, not something this scan produced.

**Run Shadow AI Scan** is real, though: it checks three things in your own workspace's real data —
1. Does any of the six real Command Center agents' assigned model (Agent Registry) not match a model this workspace can actually call — factoring in any real OpenAI/Google key you've connected (Provider Keys, above)? That's real registry drift.
2. Has a real Orchestrate run actually requested an ungoverned model (like "GPT-4o") and gotten silently substituted? That's a real, repeated request for something not really governed.
3. Has a single real call's token usage spiked sharply above that same agent's own rolling average in your workspace? A real, deterministic statistical check (a 3-sigma outlier against that agent's own call history) — not trained anomaly-detection ML, and it needs at least 5 prior calls for that agent before it trusts a baseline at all, so a brand-new workspace correctly shows nothing here yet.

Every new finding lands in the same queue as the historical ones, waiting on an Admin or Compliance Owner to **Govern** (log it, accept as known) or **Kill** (act on it — fix the registry, or dig into what an anomalous run actually asked for). **Owner** links to that agent's Agent Registry row, whether it's written as a bare agent name or a "Department — Agent name" pair. This can't detect outside tool use — a personal ChatGPT account, an unsanctioned browser extension — since nothing about those ever touches this app; that needs real endpoint/CASB integration and a real audit at a real customer.

---

## Governance Snapshot (`governance-snapshot.html`)

A single-document bundle of this workspace's real governance state — current policies, the approval record, and the audit trail — formatted for an actual auditor or customer security review, not a raw data dump like the Audit Trail's own JSON/CSV export. Pick a range (30/90/365 days or all time) to scope the Approval Record and Audit Trail sections; the Governance Policies table is always current state, since a policy is a live setting, not a historical event. Signed-in users also get a real plan/emergency-stop/retention/spend posture strip at the top — the shared public demo has no per-workspace settings to show there, so it's the one part of the report that's omitted for anonymous visitors.

**Print / Save as PDF** opens your browser's real print dialog with the console chrome stripped out — a genuine document, not a screenshot. **Copy as Markdown** copies the same real content as plain text, for pasting into an email or doc, the same "copy to clipboard" export pattern the Audit Trail already uses.

---

## Resetting demo data

Every page has a **Reset demo data** link in the footer. It only resets the shared **public demo workspace** — your own signed-in workspace is never touched by it.

---

## Troubleshooting

- **"Sign in to orchestrate" / "Sign in to ask a question"** — Orchestrate and the audit trail Q&A are both real, metered Claude API calls, so both require a signed-in session; the public demo is view-only.
- **"This workspace has used its Orchestrate limit for today"** — you've hit your plan's rolling-24h cap. An admin can upgrade the plan (Workspace modal), or wait for the rolling window to clear.
- **"This workspace has asked its limit of 40 audit trail questions for today"** — same idea, a separate cap just for Q&A.
- **A run is stuck "paused for approval"** — someone needs to decide it, from either the Command Center's own panel or the Approval Queue. Nothing else in the workspace is blocked while it waits.
- **You reassigned an agent's model but a run still uses Claude** — only "Claude Sonnet 5" and "Claude Opus 4.8" are real per-call routing targets today; anything else falls back automatically (and the Shadow AI Audit is built to flag exactly this).
