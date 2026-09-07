import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Aiven Orchestrator — real-model orchestration endpoint (Horizon 1 + 2).
// Makes six real, independent Anthropic API calls — one per Command
// Center agent, run in the same order the UI narrates (Research →
// Finance → Ops → Risk & Compliance → Strategy → Executive Writer) —
// each agent seeing the prior agents' actual output as context, not a
// single call asked to invent all six steps at once. The final call
// (the Writer) also synthesizes the run's executive summary, findings,
// recommendations, and risk flags from everything before it.
//
// Model per agent is fixed server-side (see AGENT_DEFS below), not
// driven by the Command Center's per-agent model dropdown yet — wiring
// that selector to real per-call routing is the still-open "cost-based
// automatic model routing" backlog item. Two agents (Finance, Strategy)
// are labeled "GPT-4o" elsewhere in the product's original illustrative
// design; since only an Anthropic key is configured, they run on Claude
// Sonnet 5 here — the Command Center's local agent labels were updated
// to match so the UI never claims a provider it isn't actually calling.
//
// Also enforces a per-workspace rolling 24h spend cap (each workspace's
// `daily_orchestrate_limit`, default 20) using the service role key —
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected into every
// Edge Function by Supabase, no manual secret needed for this part. The
// cap is looked up and logged server-side so a client can't raise its
// own limit or erase its own usage history to dodge it. One Orchestrate
// run still only costs one unit of quota, even though it's now six API
// calls under the hood.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// The six Command Center agents, in execution order. `model` is a real
// Anthropic model id — Opus 4.8 for the highest-stakes step (governance
// risk screening), Sonnet 5 for everything else.
const AGENT_DEFS = [
  { id: "research", name: "Research & Data Agent", model: "claude-sonnet-5", role: "pulls and reconciles data across connected systems" },
  { id: "finance", name: "Finance Agent", model: "claude-sonnet-5", role: "analyzes cost structure, margin, and variance" },
  { id: "ops", name: "Operations Agent", model: "claude-sonnet-5", role: "maps process cycle times and bottlenecks" },
  { id: "risk", name: "Risk & Compliance Agent", model: "claude-opus-4-8", role: "screens findings against governance policy; must flag exactly one realistic governance/compliance risk that would require human approval before anything ships externally" },
  { id: "strategy", name: "Strategy Agent", model: "claude-sonnet-5", role: "synthesizes findings into prioritized recommendations" },
  { id: "writer", name: "Executive Writer Agent", model: "claude-sonnet-5", role: "drafts the final executive-ready action plan" },
] as const;

// Tool schema for the five non-writer agents — just this agent's own
// step. `riskFlag` is only ever populated by the risk agent (enforced
// by that agent's prompt, not by the schema, so the same tool works for
// all five).
const STEP_TOOL = {
  name: "submit_agent_step",
  description: "Return this agent's single finding for the run.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short present-tense action, e.g. 'Analyze margin trends'" },
      detail: { type: "string", description: "1-2 sentence specific, concrete finding from this agent." },
      riskFlag: {
        type: "object",
        description: "Only the Risk & Compliance Agent sets this — the one governance flag requiring human approval before anything ships externally. Every other agent omits it.",
        properties: {
          severity: { type: "string", enum: ["Low", "Medium", "High"] },
          text: { type: "string" },
        },
      },
    },
    required: ["title", "detail"],
  },
};

// Tool schema for the final (writer) call — its own step, plus the
// synthesized result for the whole run.
const FINAL_TOOL = {
  name: "submit_final_result",
  description: "Return the Executive Writer Agent's own step, plus the synthesized executive result for the whole run.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short present-tense action for the writer's own step." },
      detail: { type: "string", description: "1-2 sentences describing the writer's own contribution." },
      executiveSummary: { type: "string", description: "2-4 sentence executive summary of the whole run." },
      findings: { type: "array", items: { type: "string" }, description: "3-5 specific findings drawn from the prior agents' steps." },
      recommendations: {
        type: "array",
        description: "2-4 prioritized recommendations.",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            owner: { type: "string", description: "A role, e.g. 'VP Operations'" },
            nextStep: { type: "string" },
            priority: { type: "string", enum: ["Low", "Medium", "High"] },
          },
          required: ["text", "owner", "nextStep", "priority"],
        },
      },
      riskFlags: { type: "array", items: { type: "string" }, description: "1-2 governance risk flags in plain language, drawn from the risk agent's step." },
    },
    required: ["title", "detail", "executiveSummary", "findings", "recommendations", "riskFlags"],
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

// Supabase JWTs (both the anon key and a real user's access token) carry
// `role` ("anon" for the public key, "authenticated" for a signed-in
// user) and, for a real user, `sub` (their user id). This call is a
// real, metered Anthropic API request — gate it to signed-in users only,
// so an anonymous visitor to the public demo can't run up the API bill
// for free.
function getJwtClaims(authHeader: string | null): { role: string | null; sub: string | null } {
  if (!authHeader) return { role: null, sub: null };
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 3) return { role: null, sub: null };
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return { role: payload.role || null, sub: payload.sub || null };
  } catch {
    return { role: null, sub: null };
  }
}

// Minimal PostgREST client using the service role key — bypasses RLS, so
// this must stay server-side only (never sent to the browser). Used
// purely to resolve the caller's workspace and enforce/record its spend
// cap; every user-data read/write elsewhere still goes through RLS with
// the caller's own token, as before.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

async function serviceRoleFetch(path: string, init: RequestInit = {}) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY!,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  return resp;
}

// Resolves the signed-in user's workspace id. Retries briefly — right
// after a first sign-in, the auto-provisioning trigger can still be
// racing this request.
async function resolveWorkspaceId(userId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await serviceRoleFetch(
      `workspace_members?select=workspace_id&user_id=eq.${userId}&limit=1`,
    );
    if (resp.ok) {
      const rows = await resp.json();
      if (rows.length) return rows[0].workspace_id;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  return null;
}

// Checks the workspace's rolling-24h Orchestrate usage against its cap.
// Returns null if under the cap (caller may proceed), or an error
// response body/status to return immediately if at/over it.
async function checkRateLimit(workspaceId: string) {
  const wsResp = await serviceRoleFetch(`workspaces?select=daily_orchestrate_limit&id=eq.${workspaceId}`);
  if (!wsResp.ok) return { error: "Failed to look up workspace spend cap.", status: 500 };
  const wsRows = await wsResp.json();
  const limit = wsRows[0]?.daily_orchestrate_limit ?? 20;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const countResp = await serviceRoleFetch(
    `orchestrate_usage?select=id&workspace_id=eq.${workspaceId}&called_at=gte.${since}`,
    { headers: { Prefer: "count=exact" } },
  );
  if (!countResp.ok) return { error: "Failed to check current usage.", status: 500 };
  const contentRange = countResp.headers.get("content-range"); // "0-4/5"
  const used = contentRange ? parseInt(contentRange.split("/")[1], 10) : (await countResp.json()).length;

  if (used >= limit) {
    return {
      error: `This workspace has used its Orchestrate limit for today (${used}/${limit} in the last 24h). The cap resets on a rolling basis — try again later.`,
      status: 429,
    };
  }
  return null;
}

async function recordUsage(workspaceId: string, userId: string) {
  await serviceRoleFetch("orchestrate_usage", {
    method: "POST",
    body: JSON.stringify({ workspace_id: workspaceId, user_id: userId }),
  });
}

// One real Anthropic call for one agent's turn. Throws a descriptive
// error (naming the agent) on any failure so the caller can abort the
// whole run cleanly instead of returning a partial result.
async function callAgent(opts: {
  apiKey: string;
  agentName: string;
  model: string;
  system: string;
  user: string;
  tool: typeof STEP_TOOL | typeof FINAL_TOOL;
  maxTokens: number;
}) {
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
        tools: [opts.tool],
        tool_choice: { type: "tool", name: opts.tool.name },
      }),
    });
  } catch (err) {
    throw new Error(`${opts.agentName}: failed to reach Anthropic API: ${String(err)}`);
  }

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`orchestrate: ${opts.agentName} API error`, resp.status, text);
    throw new Error(`${opts.agentName}: Anthropic API error (${resp.status})`);
  }

  const data = await resp.json();
  if (data.stop_reason === "max_tokens") {
    throw new Error(`${opts.agentName}: response was cut off by the token limit. Try a shorter or more specific objective.`);
  }

  const toolUse = (data.content || []).find((b: { type: string }) => b.type === "tool_use");
  if (!toolUse) {
    console.error(`orchestrate: ${opts.agentName} returned no tool_use block`, JSON.stringify(data.content));
    throw new Error(`${opts.agentName}: did not return a structured result.`);
  }

  return { input: toolUse.input, usage: data.usage, model: data.model as string };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Use POST." }, 405);
  }

  const { role, sub: userId } = getJwtClaims(req.headers.get("authorization"));
  if (role !== "authenticated" || !userId) {
    return json(
      { error: "Sign in to orchestrate — this triggers real, metered Claude API calls and is limited to signed-in workspaces. The public demo data is view-only." },
      401,
    );
  }

  const workspaceId = await resolveWorkspaceId(userId);
  if (!workspaceId) {
    return json({ error: "Could not resolve your workspace. Try reloading the page and signing in again." }, 500);
  }

  const rateLimitError = await checkRateLimit(workspaceId);
  if (rateLimitError) {
    return json({ error: rateLimitError.error }, rateLimitError.status);
  }

  let objective: string, departments: string[], sources: string[];
  try {
    const body = await req.json();
    objective = body.objective;
    departments = Array.isArray(body.departments) ? body.departments : [];
    sources = Array.isArray(body.sources) ? body.sources : [];
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  if (!objective || typeof objective !== "string") {
    return json({ error: "`objective` (string) is required." }, 400);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json(
      { error: "ANTHROPIC_API_KEY is not configured on this Edge Function. Add it in the Supabase dashboard: Project Settings → Edge Functions → Secrets." },
      500,
    );
  }

  const briefing = `Business objective: ${objective}\nDepartments in scope: ${departments.join(", ") || "none specified"}\nData sources in scope: ${sources.join(", ") || "none specified"}`;

  const steps: Array<{ agentId: string; agentName: string; title: string; detail: string; riskFlag?: { severity: string; text: string } }> = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const modelsUsed = new Set<string>();

  try {
    for (const agent of AGENT_DEFS) {
      const isWriter = agent.id === "writer";
      const priorContext = steps.length
        ? "Prior agents' findings so far, in order:\n" +
          steps.map((s) => `- ${s.agentName}: ${s.title} — ${s.detail}`).join("\n")
        : "You are the first agent in this run — no prior findings yet.";

      const system = isWriter
        ? `You are the Executive Writer Agent in the Aiven Orchestrator, a governed multi-agent enterprise workflow. Your role: ${agent.role}. You are the last agent in a real six-agent pipeline — draft the final executive-ready synthesis from everything the other five agents actually found. Do not claim to have queried real live data yourself; this is a governed simulation run for a product demo, but be concrete and specific, grounded in the prior agents' stated findings. Call the submit_final_result tool exactly once.`
        : `You are the ${agent.name} in the Aiven Orchestrator, a governed multi-agent enterprise workflow. Your role: ${agent.role}. You are one agent in a real six-agent pipeline — see the prior agents' actual findings below and build on them where relevant (don't repeat what they already covered). Be concrete and specific — invent a plausible, clearly-illustrative finding, metric, or figure appropriate to the objective, as if you had actually queried the given data sources. Do not claim to have queried real live data; this is a governed simulation run for a product demo.${agent.id === "risk" ? " You MUST set riskFlag with exactly one realistic governance/compliance risk that would require human approval before anything ships externally." : " Leave riskFlag unset — that field is only for the Risk & Compliance Agent."} Call the submit_agent_step tool exactly once with your one finding.`;

      const user = `${briefing}\n\n${priorContext}`;

      const result = await callAgent({
        apiKey,
        agentName: agent.name,
        model: agent.model,
        system,
        user,
        tool: isWriter ? FINAL_TOOL : STEP_TOOL,
        maxTokens: isWriter ? 4096 : 1024,
      });

      totalInputTokens += result.usage?.input_tokens || 0;
      totalOutputTokens += result.usage?.output_tokens || 0;
      modelsUsed.add(result.model || agent.model);

      if (isWriter) {
        const out = result.input || {};
        if (!out.title || !out.detail || !Array.isArray(out.findings) || !Array.isArray(out.recommendations) || !Array.isArray(out.riskFlags)) {
          throw new Error("Executive Writer Agent: returned an incomplete result.");
        }
        steps.push({ agentId: agent.id, agentName: agent.name, title: out.title, detail: out.detail });

        await recordUsage(workspaceId, userId);

        return json({
          result: {
            executiveSummary: out.executiveSummary,
            steps,
            findings: out.findings,
            recommendations: out.recommendations,
            riskFlags: out.riskFlags,
          },
          model: Array.from(modelsUsed).join(" · "),
          usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
        });
      }

      const out = result.input || {};
      if (!out.title || !out.detail) {
        throw new Error(`${agent.name}: returned an incomplete result.`);
      }
      steps.push({
        agentId: agent.id,
        agentName: agent.name,
        title: out.title,
        detail: out.detail,
        ...(out.riskFlag && out.riskFlag.text ? { riskFlag: out.riskFlag } : {}),
      });
    }
    // Unreachable — the loop always returns on the writer step — but
    // TypeScript wants every path to produce a Response.
    return json({ error: "Orchestration ended without a final result." }, 502);
  } catch (err) {
    console.error("orchestrate: pipeline failed", err);
    return json({ error: String(err instanceof Error ? err.message : err) }, 502);
  }
});
