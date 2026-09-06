import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Aiven Orchestrator — real-model orchestration endpoint (Horizon 1).
// Makes one real Anthropic API call (forced tool-use for structured
// output) that simulates a realistic pass by each of the six Command
// Center agents, then returns the structured result for the frontend to
// render into the existing timeline/deliverable UI. This is one real
// call producing per-agent structured output, not six independent calls
// — documented as such rather than overclaimed.

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Use POST." }, 405);
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
        max_tokens: 4096,
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
    return json({ error: `Anthropic API error (${anthropicResp.status}): ${text}` }, 502);
  }

  const data = await anthropicResp.json();
  const toolUse = (data.content || []).find((b: { type: string }) => b.type === "tool_use");
  if (!toolUse) {
    return json({ error: "Model did not return a structured result." }, 502);
  }

  return json({ result: toolUse.input, model: data.model, usage: data.usage });
});
