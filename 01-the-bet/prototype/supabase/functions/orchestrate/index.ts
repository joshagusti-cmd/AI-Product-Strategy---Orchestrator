import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Aiven Orchestrator — real-model orchestration endpoint (Horizon 1 + 2).
// Makes one real Anthropic API call (forced tool-use for structured
// output) that simulates a realistic pass by each of the six Command
// Center agents, then returns the structured result for the frontend to
// render into the existing timeline/deliverable UI. This is one real
// call producing per-agent structured output, not six independent calls
// — documented as such rather than overclaimed.
//
// Also enforces a per-workspace rolling 24h spend cap (each workspace's
// `daily_orchestrate_limit`, default 20) using the service role key —
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected into every
// Edge Function by Supabase, no manual secret needed for this part. The
// cap is looked up and logged server-side so a client can't raise its
// own limit or erase its own usage history to dodge it.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ORCHESTRATE_TOOL = {
  name: "submit_orchestration_result",
  description: "Return the structured result of orchestrating this business objective across the agent team.",
  input_schema: {
    type: "object",
    properties: {
      executiveSummary: { type: "string", description: "2-4 sentence executive summary of the whole run." },
      steps: {
        type: "array",
        description: "One entry per agent, in execution order.",
        items: {
          type: "object",
          properties: {
            agentId: { type: "string", enum: ["research", "finance", "ops", "risk", "strategy", "writer"] },
            agentName: { type: "string" },
            title: { type: "string", description: "Short present-tense action, e.g. 'Analyze margin trends'" },
            detail: { type: "string", description: "1-2 sentence specific, concrete finding from this agent." },
            riskFlag: {
              type: "object",
              description: "Only present on the risk agent's step — the one governance flag requiring human approval.",
              properties: {
                severity: { type: "string", enum: ["Low", "Medium", "High"] },
                text: { type: "string" },
              },
            },
          },
          required: ["agentId", "agentName", "title", "detail"],
        },
      },
      findings: { type: "array", items: { type: "string" }, description: "3-5 specific findings across the run." },
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
      riskFlags: { type: "array", items: { type: "string" }, description: "1-2 governance risk flags in plain language." },
    },
    required: ["executiveSummary", "steps", "findings", "recommendations", "riskFlags"],
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
      { error: "Sign in to orchestrate — this triggers a real, metered Claude API call and is limited to signed-in workspaces. The public demo data is view-only." },
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

  const systemPrompt = `You are the Aiven Orchestrator, coordinating six specialized enterprise agents to analyze a business objective and produce a governed executive action plan:
- Research & Data Agent — pulls and reconciles data across connected systems
- Finance Agent — analyzes cost structure, margin, and variance
- Operations Agent — maps process cycle times and bottlenecks
- Risk & Compliance Agent — screens findings against governance policy; must flag exactly one realistic governance/compliance risk that would require human approval before anything ships externally
- Strategy Agent — synthesizes findings into prioritized recommendations
- Executive Writer Agent — drafts the final executive-ready action plan

Given the objective, the departments in scope, and the data sources in scope, simulate a realistic, specific, and plausible pass by each of these six agents in order, as if they had actually queried the given data sources. Be concrete — invent plausible, clearly-illustrative findings, metrics, and figures appropriate to the objective. Do not claim to have queried real live data; this is a governed simulation run for a product demo. Call the submit_orchestration_result tool exactly once with the complete structured result — one step per agent, in the order listed above.`;

  const userPrompt = `Business objective: ${objective}\nDepartments in scope: ${departments.join(", ") || "none specified"}\nData sources in scope: ${sources.join(", ") || "none specified"}`;

  let anthropicResp: Response;
  try {
    anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        tools: [ORCHESTRATE_TOOL],
        tool_choice: { type: "tool", name: ORCHESTRATE_TOOL.name },
      }),
    });
  } catch (err) {
    return json({ error: `Failed to reach Anthropic API: ${String(err)}` }, 502);
  }

  if (!anthropicResp.ok) {
    const text = await anthropicResp.text();
    console.error("Anthropic API error", anthropicResp.status, text);
    return json({ error: `Anthropic API error (${anthropicResp.status}): ${text}` }, 502);
  }

  const data = await anthropicResp.json();
  console.log("orchestrate: stop_reason=", data.stop_reason, "usage=", JSON.stringify(data.usage));

  if (data.stop_reason === "max_tokens") {
    return json({ error: "The model's response was cut off by the token limit before it finished. Try a shorter or more specific objective, or fewer departments/data sources." }, 502);
  }

  const toolUse = (data.content || []).find((b: { type: string }) => b.type === "tool_use");
  if (!toolUse) {
    console.error("orchestrate: no tool_use block in response", JSON.stringify(data.content));
    return json({ error: "Model did not return a structured result (no tool_use block)." }, 502);
  }

  const steps = toolUse.input && toolUse.input.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    console.error("orchestrate: tool_use.input had no steps", JSON.stringify(toolUse.input));
    return json({ error: "Model returned a result with no agent steps. This usually means the response was too constrained — try again." }, 502);
  }

  await recordUsage(workspaceId, userId);

  return json({ result: toolUse.input, model: data.model, usage: data.usage });
});
