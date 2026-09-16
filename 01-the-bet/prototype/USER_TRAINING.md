# Aiven Orchestrator: User Training

This guide walks you through the Aiven Orchestrator console from setup to reporting, in the order you would actually use it: sign in, set up your workspace, run your first analysis, learn what happens when a run needs approval, then work through the pages that govern, audit, and report on what ran.

This is the training guide, not the field-by-field reference. For "what does this exact button or field do," see the page-by-page [User Guide](USER_GUIDE.md), which this guide links to instead of repeating. For what is real versus still modeled in the product overall, see the root [README](../../README.md) and [prototype.md](../prototype.md).

Everything described below is real and live: real Supabase Postgres, real authentication, real Claude API calls, real policy enforcement. It is not a mockup, except where a section says otherwise. A prefer to click through instead of read? The same content is also available as an in-app page at [`user-training.html`](user-training.html).

Video walkthroughs are planned for a later phase and are not part of this guide yet.

---

## Table of contents

0. [Before you start](#0-before-you-start)
1. [Signing in and finding your role](#1-signing-in-and-finding-your-role)
2. [Setting up your workspace (Admin)](#2-setting-up-your-workspace-admin)
3. [Running your first Orchestrate](#3-running-your-first-orchestrate)
4. [When a run pauses: Policies and gates](#4-when-a-run-pauses-policies-and-gates)
5. [Managing approvals](#5-managing-approvals)
6. [Managing agents](#6-managing-agents)
7. [Auditing every action](#7-auditing-every-action)
8. [Reporting](#8-reporting)
9. [Governing AI use: Shadow AI Audit](#9-governing-ai-use-shadow-ai-audit)
10. [Resetting demo data](#10-resetting-demo-data)
11. [Troubleshooting](#11-troubleshooting)
12. [Where to go next](#12-where-to-go-next)

---

## 0. Before you start

Two workspaces exist wherever you open the app:

- **The public demo.** What you see before signing in. Shared and read only. You can click through every page, but nothing that changes data will work: no running Orchestrate, no saving a policy, no deciding an approval.
- **Your own workspace.** Created automatically the first time you sign in, private to you and anyone you invite into it. Everything from here on describes your own workspace.

---

## 1. Signing in and finding your role

1. Click the auth widget in the top bar of any page and enter your email.
2. You will get a magic link. There is no password to set or remember.
3. Click the link. The first time you sign in, a private workspace is created for you automatically, pre-loaded with a starting set of agents and policies.

Every workspace member has one of three roles:

| Role | What you can do |
|---|---|
| **Admin** | Everything below, plus reassign agent models, manage the team, change the plan, and everything in [Section 2](#2-setting-up-your-workspace-admin). |
| **Compliance Owner** | Edit policies, decide Shadow AI findings (govern or kill). Admins can do this too. |
| **Analyst** | Run Orchestrate, approve or reject requests, run a Shadow AI scan, ask the audit trail a question. |

Any control you cannot use for your role is disabled in the interface, and the restriction is enforced on the server too. Hiding a button is not the actual security boundary; it is a courtesy.

If you belong to more than one workspace, a switcher appears near the auth widget so you can pick which one is active.

**On a phone.** The navigation bar at the top scrolls horizontally and automatically scrolls to the current tab. The Approval Queue also has a dedicated mobile view built for a phone screen; see [Section 5](#5-managing-approvals).

---

## 2. Setting up your workspace (Admin)

If you are not an Admin, skip ahead to [Section 3](#3-running-your-first-orchestrate). Everything in this section lives in the **Workspace modal**, opened from the auth widget.

### Invite your team

Open Workspace, then Team. Enter a teammate's email, pick their role (Admin, Compliance Owner, or Analyst), and send the invite. They join automatically the next time they sign in with that email. There is no accept step required from them. Not yet available: a member leaving on their own, or changing their own role.

### Set the plan and usage caps

Every workspace has a plan: Free, Pro, or Enterprise. The plan sets two real, enforced limits at the same time:

- Orchestrate runs allowed per rolling 24 hours: 20, 100, or 500.
- Real dollars that can be spent per rolling 24 hours: $5, $25, or $150, priced at real Anthropic rates.

Either limit alone can stop a new run. The dollar cap exists because a handful of unusually complex objectives can use real budget that a run count alone would not catch. Change the plan from Workspace, then Plan. There is no real billing behind this yet: changing the plan only changes the enforced numbers, nothing is actually charged.

### Turn on Emergency Stop if needed

Workspace, then Emergency Stop, is a single real switch for a real incident. It is bigger and blunter than disabling one agent in the Agent Registry. Turn it on and every new Orchestrate run, every paused run resume, and every external agent's approval check freezes for the whole workspace until an Admin turns it off. Every member can see whether it is active and who turned it on.

The one honest limit: it is real for everything Aiven itself runs, but it cannot reach into an external agent's own code if that code never checks in first. See [Section 6](#6-managing-agents).

### Connect your own OpenAI or Google key (optional)

By default, choosing "GPT-4o" or "Gemini 1.5 Pro" anywhere in the console falls back to that agent's Claude default without telling you unless you check. The Shadow AI Audit is built to catch exactly that kind of mismatch.

To make those providers genuinely real for your workspace, go to Workspace, then Provider Keys, and paste in your own OpenAI or Google API key. It is encrypted at rest and never shown again, only its last four characters, so you can confirm which key is connected. The moment it is saved, that provider's models become real calls instead of substitutions, and the Shadow AI Audit stops flagging that provider as drift. Remove the key at any time to fall back to Claude again.

Aiven itself does not hold a shared OpenAI or Google credential. This is real routing only for workspaces that bring their own key. You can see this reflected live in the Anthropic, OpenAI, and Google indicators next to the logo on every page. Hover over one to see the real reason behind its current state.

### Set up webhook notifications (optional)

Workspace, then Webhook Notifications, takes a plain URL. Slack's or Microsoft Teams' own incoming webhook URL works, or any generic endpoint that accepts a POST request. The moment a run actually pauses for approval, Aiven sends a real JSON message (workspace name, objective, risk severity and text, approval id, timestamp) to that URL. Every attempt is logged and shown as "last delivery: succeeded or failed, and how long ago." Today, only a run pausing triggers a webhook. There is no "send test webhook" button yet.

### Set a data retention window (optional)

Workspace, then Data Retention, sets an automatic deletion window (30, 90, 180, or 365 days, or "no automatic deletion," which is the default) for Audit Trail and Workflow History rows. It is enforced two ways: automatically once a day, and, if you want proof right now, a "Run retention now" button that deletes matching rows immediately and tells you exactly how many it removed. This cannot be undone, and it only applies to Audit Trail and Workflow History, not yet to spend data or audit trail Q&A history.

---

## 3. Running your first Orchestrate

This is the Command Center (`index.html`), the page you will use most.

1. **Enter a business objective.** The thing you want analyzed, for example: "Assess our Q3 vendor risk exposure and recommend next steps."
2. **Pick departments and data sources** in scope using the chips.
3. **Choose routing.** Leave "Auto-route models by risk and complexity" turned on (the default) and the system picks each agent's model for you. It escalates to a more capable model when your objective's text matches governance or risk keywords, or when the scope is large. Turn it off to pick each agent's model yourself.
4. Click **Orchestrate**.

What happens next is real: six independent Claude API calls run in sequence: Research, Finance, Operations, Risk and Compliance, Strategy, and the Executive Writer. Each one reads the prior agents' real output before it runs. Watch the timeline light up as each step completes.

**Two safeguards run automatically before your objective is ever sent anywhere:**

- **Redaction.** A pattern-matching pass masks Social Security numbers, emails, phone numbers, credit card numbers, and API-key-shaped strings, for example `[REDACTED:EMAIL]`, in your objective and in every agent's output before it is stored or shown. A message tells you what was masked, and it is logged to the Audit Trail.
- **Prompt injection screening.** Text that reads like an attempt to override an agent's instructions, or to extract its system prompt, is neutralized as `[FLAGGED:PROMPT_INJECTION]`. The rest of your objective still runs, and the attempt is logged as a high severity Audit Trail entry.

**If the run pauses,** that is expected, not an error. See [Section 4](#4-when-a-run-pauses-policies-and-gates).

**When the run finishes,** you get an executive summary, key findings, prioritized recommendations, and risk flags. Copy it as Markdown or print it. It is also saved automatically to Workflow History, so it is not lost once you navigate away.

**Rate limits.** Your workspace plan caps how many runs and how many real dollars can be used per day, and the console shows your current usage against both, live.

**Running the same analysis often?** Fill in the objective, scope, and routing the way you want, type a name into "Save as template," and save it. It appears in "Load a saved template," shared across your whole workspace. Pick it and every field, including per-agent model assignments, fills back in instantly, ready to run.

---

## 4. When a run pauses: Policies and gates

A run only pauses because of one policy: the **Core tier** in Policies (`policies.html`). It is the only policy tier the real pipeline checks after the Risk and Compliance Agent's finding. It has three parts: an autonomy level, a risk threshold from 0 to 100, and an escalation rule written in plain language.

The autonomy level controls whether a run ever stops:

- **Autonomous or Advisory.** The flag is shown, but the run always continues automatically. Nothing pauses.
- **Approval required.** A risk flag scoring at or above the threshold genuinely pauses the run before the Strategy and Writer steps run, along with their real API cost. This is called gate 1. A human has to decide before the run continues.
- **Two-gate.** Gate 1 works the same way, plus a real gate 2: every run this policy produces is held out of Workflow History until a second, separate approval releases it, whether or not gate 1 ever fired. You still see your own result immediately in the Command Center. Gate 2 controls when the rest of the workspace sees it.

Only Admins and Compliance Owners can edit a policy, and every save is logged to the Audit Trail.

When a gate 1 pause happens, you will see a real approval waiting in the Command Center's own panel. Approve resumes the run for real. Reject ends it for real, and no deliverable is generated either way. The same decision can also be made from the org-wide Approval Queue by anyone else in the workspace. See [Section 5](#5-managing-approvals). Both have the same real effect, just a different vantage point.

---

## 5. Managing approvals

`approvals.html` is the org-wide backlog of everything waiting on a human decision. It is filterable by risk and department. Anyone in the workspace can approve or reject.

Two kinds of rows show up here, and they behave differently:

- **A regular approval,** raised by a paused Orchestrate run or by an external agent. Deciding it either resumes the run's remaining Claude calls (Approve) or ends it for good (Reject).
- **A release approval,** titled "Release: [your objective]." This is gate 2 under a Two-gate policy. The run already finished and generated its deliverable, so there is nothing left to resume. Approve releases it into Workflow History for the whole workspace to see. Reject keeps it generated but permanently held back from that shared archive.

"Raised by" links straight back to the agent's Agent Registry row whenever the name resolves to a real one.

**On your phone.** Click "Open the mobile companion view," or go to `mobile-approvals.html`, for a page built for a phone from the ground up: two summary tiles, a Pending and All toggle, and large Approve and Reject cards. It is the same live queue and the same real decisions.

---

## 6. Managing agents

`agents.html` is the full roster the orchestrator governs: every department, tier, assigned model, status, and what each agent can and cannot do without a human.

- **Claude Sonnet 5** and **Claude Opus 4.8** are always real routing targets. **GPT-4o** and **Gemini 1.5 Pro** become real once your workspace connects its own provider key (see [Section 2](#2-setting-up-your-workspace-admin)). Otherwise, assigning them silently falls back to Claude and tells you so in a message. That mismatch is exactly what the Shadow AI Audit is built to catch. See [Section 9](#9-governing-ai-use-shadow-ai-audit).
- **Filter** by tier or by department using the built-in filters.
- A **Review** status is clickable exactly when there is a real pending approval raised by that agent. Click it to land on that exact Approval Queue row.
- The **Pipeline** column shows the six Command Center agents' real step number, plus a Writer or Risk Gate tag where it applies. The Admin-only Enabled checkbox genuinely removes an agent from the next real Orchestrate run without deleting it from the registry.
- **Add an external agent** to connect anything your team already runs elsewhere, on any stack. You get a real API key and endpoint, shown exactly once, so save it right away. Every request that agent's own code sends shows up here, in the Audit Trail, and in the Approval Queue if it reports a risk finding that crosses your Core policy's threshold, exactly like an internal agent. The honest limit: Aiven never runs that agent itself, so a gate only works if that agent's own code checks in first and honors the answer.

---

## 7. Auditing every action

`audit.html` is a real-time, searchable log of every agent and human action. Approvals, policy saves, orchestrate runs, everything lands here immediately. Export the current view as JSON or CSV.

**Filter by department** using the built-in filters, based on your real agent roster. Actor and action entries link back to the Agent Registry row or Approval Queue row they are about, whenever that resolves to something real and still present.

**Ask the audit trail.** Type a plain-language question, for example "why did the Risk and Compliance Agent flag something last week," and a real Claude call answers it, grounded strictly in your workspace's own most recent 300 log entries. If the log does not support an answer, it says so instead of inventing one. Your question and answer history is saved. This has its own limit, separate from Orchestrate: 40 questions per rolling 24 hours.

---

## 8. Reporting

Three pages, three different jobs.

### Workflow History (`workflow-history.html`)

A real, searchable archive of every completed run's full deliverable, not just the Audit Trail's one-line pointer to it. Search or filter by department, then click a row to expand the full executive summary, findings, recommendations, risk flags, and every agent step.

- **Full prompt visibility.** Each agent step has a "View prompt" option showing the exact system and user prompt that agent's real Claude call received. Runs archived before this feature shipped simply have no option to view a prompt.
- **Pending release.** A run under a Two-gate policy shows a "Pending release" badge and stays hidden here until its release approval is decided. See [Section 5](#5-managing-approvals). The "Pending release" tile counts what is waiting on you right now.
- **Comparing two runs.** Check any two rows, click "Compare selected," and see both full deliverables side by side. This is a real comparison; nothing is computed as "changed," you are simply looking at both in full.

### Model Spend Dashboard (`spend.html`)

Two things, kept deliberately separate:

- **Cost by tier and by model provider.** A modeled projection tied to the Leader, Filler, Killer pricing strategy. Illustrative, not billed.
- **Real Orchestrate spend.** Every real Claude call your workspace has actually made, priced at real, current Anthropic rates, broken down by model and by agent. This is measured, not modeled. The "Today's spend versus real cap" tile shows the same rolling 24-hour figure the backend actually enforces against your plan's dollar cap.

### Governance Snapshot (`governance-snapshot.html`)

A single-document bundle of your workspace's real governance state: current policies, the approval record, and the audit trail, formatted for an actual auditor or customer security review, not a raw data dump. Pick a range (30, 90, or 365 days, or all time) to scope the Approval Record and Audit Trail sections. The Governance Policies table is always current, since a policy is a live setting, not a historical event. Signed-in users also get a plan, emergency stop, retention, and spend summary at the top.

- "Print, or save as PDF" opens your browser's real print dialog with the console frame stripped out: a genuine document, not a screenshot.
- "Copy as Markdown" copies the same content as plain text, for pasting into an email or another document.

---

## 9. Governing AI use: Shadow AI Audit

`shadow-ai.html` shows a list of illustrative historical findings as background context. That list is narrative from the original governance case study, not something a scan produced.

**Run Shadow AI Scan** is real, though, and checks three things in your own workspace's real data:

1. Does any of the six Command Center agents' assigned model, from the Agent Registry, fail to match a model this workspace can actually call, accounting for any connected provider key? That is real registry drift.
2. Has a real Orchestrate run actually requested an ungoverned model and been silently substituted? That is a real, repeated request for something not really governed.
3. Has a single real call's token usage spiked sharply above that agent's own rolling average? This is a real, deterministic statistical check, a 3-sigma outlier, not trained machine learning. It needs at least 5 prior calls for that agent before it trusts a baseline, so a brand-new workspace correctly shows nothing here yet.

Every finding lands in the same queue, waiting on an Admin or Compliance Owner to decide:

- **Govern.** Log the finding as known and accepted. No other setting changes.
- **Kill.** Flag it as needing real action, such as fixing the registry or looking into what an anomalous run actually asked for. Kill records the decision, but does not automatically fix anything by itself.

What this cannot do: detect outside tool use, such as a personal ChatGPT account or an unsanctioned browser extension, since nothing about those ever touches this app. That kind of detection needs real endpoint or CASB integration at a real customer.

---

## 10. Resetting demo data

Every page has a "Reset demo data" link in the footer. It only resets the shared public demo workspace. Your own signed-in workspace is never touched by it.

---

## 11. Troubleshooting

See [the Troubleshooting section of the User Guide](USER_GUIDE.md#troubleshooting) for the current list of known messages and what they mean. It is kept current there instead of duplicated here.

---

## 12. Where to go next

- **Page-by-page reference, every field explained:** [USER_GUIDE.md](USER_GUIDE.md)
- **The same guide, in the console itself:** [user-training.html](user-training.html)
- **What is real versus still modeled or simulated across the whole product:** [prototype.md](../prototype.md)
- **Product strategy and pitch:** the root [README.md](../../README.md)

Video walkthroughs of this same path are planned for a later phase and are not part of this guide.
