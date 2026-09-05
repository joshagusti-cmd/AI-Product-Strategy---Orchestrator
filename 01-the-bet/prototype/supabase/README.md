# Backend — Horizon 1

This is the real, shared backend behind `01-the-bet/prototype/` — a persistent Postgres database and one Edge Function making real Claude API calls, replacing the original localStorage simulation. It's committed here for version control and reproducibility; the live copy runs on Supabase.

## What's here

- `migrations/0001_init_governance_schema.sql` — five tables (`agents`, `policies`, `approvals`, `shadow_tools`, `audit_log`) matching the prototype's data shape, with RLS enabled and seeded with the same demo data the prototype always shipped with.
- `migrations/0002_reseed_demo_data_function.sql` — a `reseed_demo_data()` RPC the "Reset demo data" button calls to put the shared database back to its seeded state, without exposing raw truncate/DDL to the public anon key.
- `functions/orchestrate/index.ts` — a Deno Edge Function that makes one real Anthropic API call (forced tool-use for structured JSON output) simulating a realistic pass by the Command Center's six agents, given a business objective, departments, and data sources. Returns per-agent steps, an executive summary, findings, recommendations, and risk flags for the frontend to render.

## Live project

- Supabase project: `aiven-orchestrator` (ref `uqgdruekuwitjwyotdud`), org "Aiven Consulting Group"
- The frontend (`assets/data.js`) talks to it directly via the public anon/publishable key — safe to expose client-side, access is scoped by the RLS policies in the migration above, not by key secrecy.

## Security tradeoff — read this before treating this as production-ready

**There is no auth in this pass** (Horizon 2 in `06-the-pitch/roadmap.md` covers real auth/multi-tenancy). RLS is *on* for every table, but every policy is permissive: anyone with the public anon key — which is, by design, visible in this repo's client-side JS — can read and write every row in every table. That's an acceptable tradeoff for a shared design-partner demo where the interesting thing to prove is "real persistent backend + real model calls," not access control. It is **not** acceptable for real customer data. Horizon 2 needs to replace the "anon full access" policies with policies scoped to an authenticated workspace before this holds anything real.

## One manual step: the Anthropic API key

The `orchestrate` function needs `ANTHROPIC_API_KEY` as a secret — nobody but a human with dashboard access can set this (no available tool sets Edge Function secrets, and an API key should never be pasted into an AI chat or committed to a repo). To set it:

1. Supabase dashboard → this project → **Project Settings → Edge Functions → Secrets**
2. Add `ANTHROPIC_API_KEY` with a real key from https://console.anthropic.com/
3. That's it — no redeploy needed, the function reads it via `Deno.env.get` on every invocation.

Until that's set, the Command Center's "Orchestrate" button will fail with a clear error toast explaining exactly this.

## Reproducing this elsewhere (new project, or after a reset)

With the [Supabase CLI](https://supabase.com/docs/guides/cli) linked to a project:

```bash
supabase link --project-ref <your-project-ref>
supabase db push                              # applies migrations/*.sql in order
supabase functions deploy orchestrate --no-verify-jwt=false
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

Then update `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `../assets/data.js` to point at the new project.
