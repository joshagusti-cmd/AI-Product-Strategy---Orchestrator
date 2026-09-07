# Backend — Horizon 1 + 2 (real backend, real model calls, real multi-tenant auth)

This is the real backend behind `01-the-bet/prototype/` — a persistent Postgres database, real multi-tenant auth, and an Edge Function making real Claude API calls. It's committed here for version control and reproducibility; the live copy runs on Supabase.

## What's here

- `migrations/0001_init_governance_schema.sql` — five tables (`agents`, `policies`, `approvals`, `shadow_tools`, `audit_log`) matching the prototype's data shape, seeded with the prototype's original demo data.
- `migrations/0002_reseed_demo_data_function.sql` — the first version of the `reseed_demo_data()` RPC (superseded by 0004/0005 below, kept for history).
- `migrations/0003_add_workspaces_and_multi_tenancy.sql` — adds `workspaces` + `workspace_members`, a `workspace_id` column on every table, and switches every text primary key (e.g. agents' `id: 'research'`) to a composite `(workspace_id, id)` key since ids are now only unique *within* a workspace.
- `migrations/0004_auto_provision_workspace_on_signup.sql` — a trigger on `auth.users` that auto-creates a private workspace (+ pre-seeded agent roster and policies, clean activity history) the moment someone signs in for the first time.
- `migrations/0005_harden_internal_functions.sql` — moves the internal helper functions (`is_workspace_member`, `handle_new_user`, `seed_workspace_config`, `seed_demo_activity`) into a `private` schema so they're usable by RLS policies and the signup trigger but not directly callable via the public REST/RPC API — a real finding from Supabase's own security advisor, fixed here.
- `migrations/0006_orchestrate_rate_limit.sql` — adds a `daily_orchestrate_limit` column on `workspaces` (default 20) and an insert-only `orchestrate_usage` log table, giving every workspace a rolling-24h spend cap on real Claude calls.
- `migrations/0007_teams_and_invites.sql` — adds `workspace_invites` (a member invites a teammate by email) and two acceptance paths: the signup trigger joins a brand-new user straight into the inviting workspace if their email has a pending invite, and the `accept_pending_invites()` RPC (called by the frontend once per session) does the same for an already-registered user invited later. Also adds `list_workspace_members()` (returns a workspace's roster with emails — `auth.users` isn't otherwise exposed) and a delete policy letting a member remove a *different* member from `workspace_members`.
- `migrations/0008_rbac_within_workspace.sql` — makes the `role` column on `workspace_members`/`workspace_invites` real: three roles (`admin`, `compliance_owner`, `analyst`, matching `05-the-guardrails/compounding-system.md`'s governance model), each backed by an RLS policy, not just a UI label. Admin gates agent model reassignment and all team management (invite, revoke, remove, change another member's role); admin-or-compliance_owner gates policy edits and Shadow AI govern/kill decisions; everything else (approving/rejecting, running a Shadow AI scan, orchestrating) stays open to any member.
- `functions/orchestrate/index.ts` — a Deno Edge Function that makes **six real, independent** Anthropic API calls (forced tool-use for structured JSON output), one per Command Center agent, run in order — Research → Finance → Ops → Risk & Compliance → Strategy → Executive Writer — with each agent's prompt including the prior agents' actual output as context. Which real Claude model runs each agent is real per-call routing, in one of two modes: **manual** — the frontend sends the Command Center's current per-agent model selections (`agentModels`), and `resolveAgentModel` maps each label to a real Anthropic model id, falling back to that agent's default (Opus 4.8 for Risk & Compliance, Sonnet 5 for the rest) for the two dropdown options with no real key configured (GPT-4o, Gemini 1.5 Pro) — the response's `substitutions` array tells the frontend exactly what ran instead; or **automatic** (`autoRoute: true`, the Command Center's default) — `computeAutoRoute` picks a three-tier cascade (baseline/elevated/high) itself from a real, deterministic heuristic (risk keywords found in the objective text + department/source scope size), mirroring the Leader/Filler/Killer cost-cascade concept in `03-the-margin/cost-curve.md`; the response's `routing` object reports the tier and exactly which signals triggered it. The final (Writer) call also synthesizes the executive summary, findings, recommendations, and risk flags from everything the other five agents found. **Requires a signed-in session** (see below) — it inspects the caller's JWT `role` claim and rejects anonymous requests with a 401, since these are real, metered API calls. It also enforces each workspace's rolling-24h Orchestrate cap server-side, using the service role key to resolve the caller's workspace and log usage — a client can't raise its own limit or erase its usage history to dodge it, and one Orchestrate run only costs one unit of quota no matter how many of the six calls it takes.

## Live project

- Supabase project: `aiven-orchestrator` (ref `uqgdruekuwitjwyotdud`), org "Aiven Consulting Group"
- The frontend (`assets/data.js`) talks to it directly via the public anon/publishable key plus, once signed in, the user's own session token — both are safe to use client-side; access is scoped by the RLS policies below, not by key secrecy.

## The multi-tenancy model

- **One public "Demo Workspace"** (`00000000-0000-0000-0000-000000000001`) — readable by anyone, including anonymous visitors (the anon key), but writable only by its own members. In practice: anonymous visitors get a **read-only** view of the shared demo; every write action (model reassignment, policy save, approve/reject, govern/kill, orchestrate) requires signing in.
- **Every signed-in user gets their own private workspace on first sign-in** — auto-created and pre-seeded (agent roster + policies; approvals/shadow tools/audit log start empty), via the `handle_new_user` trigger, unless they were already invited (see below). Their reads and writes are scoped entirely to that workspace, isolated from the demo and from every other user's workspace by RLS (`is_workspace_member(workspace_id)`).
- **A workspace member can invite a teammate by email** (the "Team" button in the auth widget). The invite is matched by email, not a token/link — the teammate just needs to sign in (or sign up) with that same email, and `private.accept_pending_invites_for()` joins them to the workspace automatically, either from the signup trigger (brand-new user) or from the `accept_pending_invites()` RPC the frontend calls on every session (already-registered user invited later). A user can belong to more than one workspace this way; the auth widget shows a workspace switcher once they do.
- **Auth is email magic-link (no passwords)** via `supabase.auth.signInWithOtp()`. There's no separate account/org management UI beyond the Team modal — no company name, no billing entity, just workspaces and their members.

## Security posture

RLS is on for every table, with real per-workspace isolation now (a real improvement over the original wide-open "anon full access" policies from Horizon 1's first pass). What's still simplified, and would need work before real customer data:

- **Teams/invites and RBAC are both real now** — a member invites a teammate by email with a chosen role and they join automatically; an admin can change any other member's role or remove them from the Team modal. Still simplified: no invite expiry, no re-sending a revoked invite without creating a fresh one, and no self-service "leave workspace" or role change (an admin can't demote themselves — avoids locking a workspace out of admins by accident, but also means there's no way to hand off sole-admin status without a second admin already in place).
- **RBAC is three flat roles, not a hierarchy or custom permissions** — `admin` (agent model reassignment + all team management), `compliance_owner` (policy edits + Shadow AI govern/kill decisions — `admin` can do these too), and `analyst` (everything else: approve/reject, run a Shadow AI scan, orchestrate). There's no way to define a custom role or grant one specific permission outside these three bundles.
- **Orchestrate now has a real spend cap** — each workspace gets a `daily_orchestrate_limit` (default 20, rolling 24h window), enforced by the Edge Function itself using the service role key (not just something the client checks and could skip). Still simplified: the limit is a single hardcoded default, not tied to a real plan/billing tier, and there's no admin UI to change a workspace's limit (would need a direct SQL update today).
- **Orchestrate is now six sequential calls, so a run takes longer (~30–60s vs. ~10–30s) and any one agent's failure fails the whole run** — there's no partial-credit result if, say, the fourth of six calls errors. The upside: usage is only recorded against the workspace's quota after the final (Writer) call succeeds, so a failed run never costs quota — but a slow or flaky Anthropic response now has more chances to interrupt a run than the old single-call version did.
- **Model routing is real but Claude-only** — the Command Center's per-agent model dropdown genuinely changes which model runs that agent's call. Two of its four options (GPT-4o, Gemini 1.5 Pro) aren't real, since only an Anthropic key is configured; picking either falls back to that agent's Claude default rather than erroring, and the frontend surfaces a toast naming the substitution. True multi-provider support is still open.
- **Automatic routing is a real but simple heuristic, not a risk model** — `computeAutoRoute` only sees the objective's text and how many departments/sources are in scope; it has no access to real transaction data, prior run history, or the kind of scored risk signal `03-the-margin/cost-curve.md`'s Leader-tier model actually produces. It's a genuine deterministic cascade (same input always gives the same tier), explainable in the response, and a real first implementation of "cost-based automatic model routing" — just not a claim of true risk assessment.

## Two manual steps (can't be done by a coding agent)

### 1. The Anthropic API key

The `orchestrate` function needs `ANTHROPIC_API_KEY` as a secret:

1. Supabase dashboard → this project → **Project Settings → Edge Functions → Secrets**
2. Add `ANTHROPIC_API_KEY` with a real key from https://console.anthropic.com/
3. No redeploy needed — the function reads it via `Deno.env.get` on every invocation.

### 2. Allow the site's URL as an auth redirect

Magic-link sign-in redirects back to the page the user started from. Supabase only allows redirecting to URLs on an allowlist:

1. Supabase dashboard → this project → **Authentication → URL Configuration**
2. Set **Site URL** to the GitHub Pages URL (e.g. `https://joshagusti-cmd.github.io/AI-Product-Strategy---Orchestrator/`)
3. Add the same URL (and `.../index.html`, `.../agents.html`, etc., or a wildcard like `https://joshagusti-cmd.github.io/AI-Product-Strategy---Orchestrator/*` if the dashboard supports it) under **Redirect URLs**.

Until this is set, clicking a magic link will fail to return the user to the site with a valid session.

## Reproducing this elsewhere (new project, or after a reset)

With the [Supabase CLI](https://supabase.com/docs/guides/cli) linked to a project:

```bash
supabase link --project-ref <your-project-ref>
supabase db push                              # applies migrations/*.sql in order
supabase functions deploy orchestrate --no-verify-jwt=false
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Then update `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `../assets/data.js` to point at the new project, and complete the two manual steps above (API key secret + auth redirect URL) for the new project.
