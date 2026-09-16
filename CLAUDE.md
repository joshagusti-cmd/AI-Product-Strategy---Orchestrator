# CLAUDE.md

Orientation for any Claude Code session working in this repo. Read this before making changes.

## What this repo is

`AI-Product-Strategy---Orchestrator` is a six-module product strategy exercise ("The Bet," "The
Moat," "The Margin," "The Contract," "The Guardrails," "The Pitch" — `0X-the-*/` folders, see root
`README.md` for the full narrative). The one module with real, running code is **The Bet**
(`01-the-bet/`): a clickable governance-platform prototype called **Aiven Orchestrator**, at
`01-the-bet/prototype/`.

The prototype is not a mockup. It's a real Supabase-backed SaaS product: real Postgres, real
multi-tenant auth (magic-link sign-in, auto-provisioned private workspaces, RBAC), real Claude API
orchestration calls (Supabase Edge Functions), real policy gating, real spend tracking. Read
`01-the-bet/prototype/USER_GUIDE.md` for what every page actually does today — it's a living doc,
kept current feature-by-feature, and is more reliable than this file for product behavior.

## Stack

- **Frontend**: plain multi-page HTML/CSS/JS under `01-the-bet/prototype/*.html` — no build step,
  no framework. `assets/data.js` is the single shared client module (`window.Aiven` namespace),
  loaded via `<script>` tag on every page; it wraps all `supabase-js` calls (loaded from a CDN
  `<script>` tag before it). `assets/shared.css` holds the shared design system.
- **Backend**: Supabase project `uqgdruekuwitjwyotdud` — Postgres (`supabase/migrations/`, 25+
  files as of this writing), Edge Functions (`supabase/functions/`: `orchestrate`, `audit-qa`,
  `agent-events`), RLS policies, `pg_cron` jobs (data retention), Supabase Vault (BYO provider
  keys). Use the `Supabase` MCP tools for schema/migration/function work — inspect existing tables
  before altering, check advisories, and prefer additive migrations.
- **Real model calls**: `orchestrate` runs six sequential Claude API calls (Research → Finance →
  Operations → Risk & Compliance → Strategy → Executive Writer), each reading the prior agents'
  real output. `verify_jwt: false` is required on `orchestrate` — don't change it.

## Design system

Dark "governance terminal" console — sharp corners, monospace-forward labels, one amber accent
color, IBM Plex Mono/Sans/Serif (loaded via Google Fonts, not a default sans stack). The Command
Center's deliverable and Governance Snapshot's export switch to a cream-paper "official document"
register with real serif prose — a deliberate contrast with the terminal. The `.stamp` component
marks every real human governance decision (approve/reject, govern/kill, release) with a rotated
ink-stamp mark and a one-time "stamp hitting paper" animation — not a colored pill. Keep new UI
consistent with this; it's specific to what the product is, not decoration.

## Editing Edge Functions

There's no file-path deploy mechanism for `mcp__Supabase__deploy_edge_function` — the full file
content has to be transcribed into the tool call as a literal string. After deploying, always
verify with `mcp__Supabase__get_edge_function` fetched back and diffed against the local repo file
to confirm byte-for-byte identity before trusting it's live.

## Migrations

Write a new numbered file in `supabase/migrations/` (check the highest existing number first —
`mcp__Supabase__list_migrations` is the source of truth for what's actually applied; local files
can lag) **and** apply it via `mcp__Supabase__apply_migration`. Both steps are required — a local
file with nothing applied, or an applied migration with no local file, are both a stale/incomplete
state. Prefer plain nullable columns over enforced foreign keys where a table's primary key is
composite (`agents`/`approvals` both use `(id, workspace_id)`) — this codebase already trusts
several unenforced references (`orchestrate_runs.approval_id`), so match that convention rather
than introducing a composite FK for a new one.

## Verifying a change actually works

This sandbox's egress proxy blocks the CDN that serves `supabase-js`, so any page's real inline
script crashes before running unless `window.supabase` is stubbed first. The pattern that works:

1. `python3 -m http.server 8099` from `01-the-bet/prototype/`.
2. Playwright (`/opt/pw-browsers/chromium` — pre-installed; never run `playwright install`) with a
   `window.supabase` stub injected via `page.addInitScript`, passing fixtures/session as **one**
   combined object argument (`addInitScript(fn, arg)` only accepts a single arg — passing several
   silently drops everything after the first).
3. The stub's `auth.onAuthStateChange` callback must actually be **invoked** (e.g. via
   `setTimeout(() => cb('INITIAL_SESSION', session), 0)`) — `data.js`'s `ready` promise only
   resolves once that fires, so a stub that registers the callback without calling it hangs every
   page's `loadState()` forever with no error.
4. To exercise real-workspace (non-demo) code paths, the stub also needs a `workspace_members`
   fixture row and a non-null fake session — several features (Workflow History, Model Spend's
   real-agent-rows table, Governance Snapshot's plan/spend strip) render nothing in demo/anonymous
   mode, which can look like a bug in the app when it's actually the test session being anonymous.
5. Screenshot and/or assert on rendered DOM state; don't just check for the absence of console
   errors — several real bugs this project has hit only showed up as wrong/missing content, not
   exceptions.

Delete scratch test files and stop the local server when done; nothing under `/tmp/*` belongs in
the repo.

## Git workflow

This repo squash-merges PRs. That means a long-lived feature branch goes stale against
`origin/main` the moment its own prior PR merges — the branch's local history still has the
pre-squash commit, which diverges from the new squashed commit on `main` even though the tree
content is identical. Before committing new work:

```
git fetch origin main -q
git checkout -B <branch-name> origin/main -q   # rebuild on main's current tip, not the branch's own stale remote
# ...make/commit changes...
git push -u origin <branch-name> --force-with-lease
```

Building on the branch's own stale remote tip (instead of `origin/main`) has caused a real merge
conflict in the past despite identical tree content — always rebuild from `origin/main`.

Before opening a PR, check for a template (none exists in this repo as of writing). After opening,
confirm `mergeable_state` is `"clean"` before merging — `"unknown"` means GitHub hasn't finished
computing it yet, re-check rather than merging blind. After merging, `git diff origin/main~1
origin/main --stat` should match the PR's own file list exactly, as a final sanity check.

Only commit, push, or open/merge a PR when the user has actually asked for it or approved the
specific plan — don't take that step on your own initiative mid-task.

## Docs stay current

`01-the-bet/prototype/USER_GUIDE.md` is a living doc — every PR that changes what a user sees or
does should update it in the *same* PR, not as a separate later pass. It went stale for a stretch
of six PRs before this file existed; don't let that repeat. The root `README.md` and
`01-the-bet/prototype.md` carry the strategic/pitch framing and get updated for real capability
additions (new backend features), not for UI/navigation polish — use judgment on which doc a given
change belongs in.

## Attribution

Follow whatever attribution instructions the current session's system reminders specify for
commits and PRs — they're session-specific (carry a session URL) and shouldn't be copied from an
old session or hardcoded here.
