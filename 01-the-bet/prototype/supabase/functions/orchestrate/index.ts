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
// Model per agent is real per-call routing, driven by the Command
// Center's per-agent model dropdown: the frontend sends its current
// `agentModels` selections (display labels, e.g. "Claude Opus 4.8") and
// each agent's call uses whichever real Claude model that label maps to
// (see MODEL_LABEL_TO_ID below). AGENT_DEFS' `model`/`label` are just
// the default routing when the caller sends no override. Two of the
// four dropdown options (GPT-4o, Gemini 1.5 Pro) aren't real — only an
// Anthropic key is configured — so a request for either falls back to
// that agent's Claude default and the response's `substitutions` array
// tells the frontend exactly what ran instead, so the UI never silently
// claims a provider it isn't actually calling.
//
// Also enforces a per-workspace rolling 24h spend cap (each workspace's
// `daily_orchestrate_limit`, default 20) using the service role key —
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected into every
// Edge Function by Supabase, no manual secret needed for this part. The
// cap is looked up and logged server-side so a client can't raise its
// own limit or erase its own usage history to dodge it. One Orchestrate
// run still only costs one unit of quota, even though it's now six API
// calls under the hood.
//
// Optional automatic model routing (`autoRoute: true` in the request
// body) replaces the manual per-agent `agentModels` selections with a
// real, deterministic cascade-by-risk decision — see computeAutoRoute
// below — the "cost-based automatic model routing" cascade this
// product's own pricing model (03-the-margin/cost-curve.md) describes,
// now actually implemented rather than just manually picked per agent.
//
// The Policy Editor's Core-tier policy (id: 'compliance' — the tier
// every Command Center agent belongs to) now actually gates this
// pipeline, instead of the policies table having no real consumer: if
// that policy's autonomy is "Approval-required" or "Two-gate" and the
// Risk & Compliance Agent's real risk flag scores at or above its
// risk_threshold, the run pauses right there — the Strategy and Writer
// calls (and their real API cost) don't happen until a human approves
// it in the Approval Queue (or the Command Center's own approval
// panel). Rejecting it ends the run for real: no executive deliverable
// is ever generated. See shouldPauseForPolicy/createPendingApproval/
// handleResume below, and migrations/0011_policy_gated_approvals.sql.
//
// Every silent substitution above (a request for a model with no real
// key configured) also leaves a real trace, not just the frontend's
// toast: logCall records the originally-requested label alongside what
// actually ran (migrations/0012), so the Shadow AI Audit's discovery
// scan can find real, repeated requests for an ungoverned model —
// genuine unmanaged-tool-use signal from this workspace's own real
// telemetry, not a fixed list of fictional findings.
//
// Every completed run (a fresh one or a paused one resumed to
// completion) also gets archived in full — see recordRun below,
// migrations/0013_workflow_history.sql — so workflow-history.html can
// redisplay a past deliverable exactly as it looked, instead of it
// only ever existing in the browser tab that generated it.

// Objective text and scope size are the only signals available before
// any agent has run — this is a real, cheap, explainable heuristic, not
// a claim of true risk assessment. Keyword list is deliberately narrow
// and enterprise-governance-flavored (legal/compliance/financial/PII)
// rather than a general sentiment/toxicity classifier.
const RISK_KEYWORDS = [
  "compliance", "regulatory", "regulation", "legal", "lawsuit", "litigation",
  "layoff", "termination", "terminate", "pii", "personal data", "gdpr", "hipaa",
  "sox", "financial statement", "sec filing", "audit", "fraud", "security breach",
  "data breach", "discrimination", "harassment", "earnings", "merger", "acquisition",
  "restructuring", "whistleblower", "investigation",
];

// Maps the Risk & Compliance Agent's qualitative riskFlag.severity to a
// number comparable against a policy's 0-100 risk_threshold. Real and
// deterministic, not a trained score — same honesty as computeAutoRoute
// below: a first cut at "does this cross the policy's line," not a
// claim of true scored risk assessment.
const RISK_SEVERITY_SCORE: Record<string, number> = { Low: 25, Medium: 60, High: 90 };

type AutoTier = "baseline" | "elevated" | "high";

// Three-tier cascade mirroring the Leader/Filler/Killer cost model this
// whole product is built around: cheap model for routine, low-stakes
// work; escalate to a more capable model only where risk/complexity
// signals actually warrant the extra cost and latency.
const AUTO_ROUTE_TIERS: Record<AutoTier, Record<string, string>> = {
  baseline: { research: "claude-haiku-4-5", finance: "claude-haiku-4-5", ops: "claude-haiku-4-5", risk: "claude-sonnet-5", strategy: "claude-sonnet-5", writer: "claude-sonnet-5" },
  elevated: { research: "claude-sonnet-5", finance: "claude-sonnet-5", ops: "claude-sonnet-5", risk: "claude-opus-4-8", strategy: "claude-sonnet-5", writer: "claude-sonnet-5" },
  high: { research: "claude-sonnet-5", finance: "claude-sonnet-5", ops: "claude-sonnet-5", risk: "claude-opus-4-8", strategy: "claude-opus-4-8", writer: "claude-opus-4-8" },
};

function computeAutoRoute(objective: string, departments: string[], sources: string[]) {
  const lower = objective.toLowerCase();
  const matchedKeywords = RISK_KEYWORDS.filter((kw) => lower.includes(kw));
  const complexityScore = departments.length + sources.length;

  let tier: AutoTier;
  if (matchedKeywords.length >= 2 || (matchedKeywords.length >= 1 && complexityScore >= 5)) {
    tier = "high";
  } else if (matchedKeywords.length >= 1 || complexityScore >= 4) {
    tier = "elevated";
  } else {
    tier = "baseline";
  }

  return { tier, matchedKeywords, complexityScore, modelsByAgent: AUTO_ROUTE_TIERS[tier] };
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// The six Command Center agents, in execution order. `model`/`label` are
// the default routing — Opus 4.8 for the highest-stakes step (governance
// risk screening), Sonnet 5 for everything else — used whenever the
// caller doesn't override an agent via `agentModels` in the request body.
const AGENT_DEFS = [
  { id: "research", name: "Research & Data Agent", model: "claude-sonnet-5", label: "Claude Sonnet 5", role: "pulls and reconciles data across connected systems" },
  { id: "finance", name: "Finance Agent", model: "claude-sonnet-5", label: "Claude Sonnet 5", role: "analyzes cost structure, margin, and variance" },
  { id: "ops", name: "Operations Agent", model: "claude-sonnet-5", label: "Claude Sonnet 5", role: "maps process cycle times and bottlenecks" },
  { id: "risk", name: "Risk & Compliance Agent", model: "claude-opus-4-8", label: "Claude Opus 4.8", role: "screens findings against governance policy; must flag exactly one realistic governance/compliance risk that would require human approval before anything ships externally" },
  { id: "strategy", name: "Strategy Agent", model: "claude-sonnet-5", label: "Claude Sonnet 5", role: "synthesizes findings into prioritized recommendations" },
  { id: "writer", name: "Executive Writer Agent", model: "claude-sonnet-5", label: "Claude Sonnet 5", role: "drafts the final executive-ready action plan" },
] as const;

// Real Claude model each dropdown label maps to. The dropdown also
// offers "GPT-4o" and "Gemini 1.5 Pro" (illustrative multi-provider
// options from the original design) — neither has a real key configured,
// so they're deliberately absent here and any request for them falls
// back to the agent's default (see resolveAgentModel below).
const MODEL_LABEL_TO_ID: Record<string, string> = {
  "Claude Sonnet 5": "claude-sonnet-5",
  "Claude Opus 4.8": "claude-opus-4-8",
};

function resolveAgentModel(agent: (typeof AGENT_DEFS)[number], requestedLabel: unknown) {
  if (typeof requestedLabel === "string" && MODEL_LABEL_TO_ID[requestedLabel]) {
    return { modelId: MODEL_LABEL_TO_ID[requestedLabel], label: requestedLabel };
  }
  const substitution = typeof requestedLabel === "string" && requestedLabel !== agent.label
    ? { agentId: agent.id, agentName: agent.name, requested: requestedLabel, used: agent.label }
    : null;
  return { modelId: agent.model, label: agent.label, substitution };
}

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
        // Both required together, or omit riskFlag entirely — the pause
        // check below only fires when both are present (out.riskFlag &&
        // out.riskFlag.text), so a schema that let severity through
        // without text would let a real governance flag silently skip
        // the human-approval gate.
        required: ["severity", "text"],
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

// Archives a completed run's full deliverable — every agent step, the
// executive summary, findings, recommendations, and risk flags —
// exactly what workflow-history.html needs to redisplay it later
// (migrations/0013_workflow_history.sql). Distinct from recordUsage
// above (one row, purely for the rate-limit check) and from logCall
// (one row per individual agent call, for spend telemetry) — this is
// the one durable copy of what the run actually produced. Called once,
// right alongside recordUsage, at both real completion points (a fresh
// run finishing, or a paused run resumed to completion).
async function recordRun(
  ctx: RunCtx,
  result: { executiveSummary: string; steps: RunCtx["steps"]; findings: string[]; recommendations: unknown[]; riskFlags: string[] },
  model: string,
  wasPaused: boolean,
  approvalId: string | null,
) {
  try {
    await serviceRoleFetch("orchestrate_runs", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: ctx.workspaceId,
        user_id: ctx.userId,
        objective: ctx.objective,
        departments: ctx.departments,
        sources: ctx.sources,
        auto_route: ctx.autoRoute,
        routing: routingInfo(ctx),
        steps: result.steps,
        executive_summary: result.executiveSummary,
        findings: result.findings,
        recommendations: result.recommendations,
        risk_flags: result.riskFlags,
        model,
        input_tokens: ctx.totalInputTokens,
        output_tokens: ctx.totalOutputTokens,
        substitutions: ctx.substitutions,
        was_paused: wasPaused,
        approval_id: approvalId,
      }),
    });
  } catch (err) {
    // Archiving must never break a real orchestration run.
    console.error("orchestrate: failed to record run history", err);
  }
}

// Logs one real agent call's real model + token usage for spend
// telemetry (migrations/0010). Called for every agent call that
// completes, regardless of whether the overall run later succeeds —
// those tokens were still really billed by Anthropic the moment the
// call returned. Distinct from recordUsage above, which only fires once
// per successful run and exists purely for the rate-limit check.
//
// `requestedModel` is set only when the caller asked for a label with
// no real key configured (e.g. "GPT-4o") and got silently substituted
// — a real, queryable trace of ungoverned model *requests*, not just
// the toast the frontend shows in the moment. Powers the Shadow AI
// Audit's real discovery scan (migrations/0012).
async function logCall(
  workspaceId: string,
  userId: string,
  agentId: string,
  model: string,
  usage: { input_tokens?: number; output_tokens?: number } | undefined,
  requestedModel: string | null,
) {
  try {
    await serviceRoleFetch("orchestrate_call_log", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: workspaceId,
        user_id: userId,
        agent_id: agentId,
        model,
        input_tokens: usage?.input_tokens || 0,
        output_tokens: usage?.output_tokens || 0,
        requested_model: requestedModel,
      }),
    });
  } catch (err) {
    // Telemetry must never break a real orchestration run.
    console.error("orchestrate: failed to log call", err);
  }
}

// Reads the workspace's Core-tier policy (id: 'compliance' — the tier
// every Command Center agent belongs to; see migrations/0011). Returns
// null if it's missing (e.g. hand-edited out of the demo data) so the
// gate fails OPEN — the run completes exactly as it did before this
// feature existed, rather than a deleted seed row silently wedging
// every future run in this workspace.
async function getCompliancePolicy(workspaceId: string): Promise<{ autonomy: string; risk_threshold: number } | null> {
  const resp = await serviceRoleFetch(
    `policies?select=autonomy,risk_threshold&workspace_id=eq.${workspaceId}&id=eq.compliance`,
  );
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows[0] || null;
}

// The real gate: only "Approval-required" and "Two-gate" autonomy ever
// pause a run — "Autonomous" and "Advisory" mean exactly what their
// labels say (generate automatically; advisory-only for the human) and
// never block. A "Two-gate" policy's second gate (approval to
// distribute externally) isn't modeled here — the Command Center has no
// separate "send externally" action to gate — so both block the same
// single point, before the Strategy/Writer calls.
function shouldPauseForPolicy(policy: { autonomy: string; risk_threshold: number } | null, riskFlag: { severity?: string }): boolean {
  if (!policy) return false;
  if (policy.autonomy !== "Approval-required" && policy.autonomy !== "Two-gate") return false;
  const score = RISK_SEVERITY_SCORE[riskFlag.severity || ""] || 0;
  return score >= policy.risk_threshold;
}

// Inserts a real, workspace-visible approvals row (via the service role
// key, same as every other write in this file) carrying everything
// needed to resume the run later — see handleResume below. Any
// workspace member can approve/reject it, from the Approval Queue or
// the Command Center's own approval panel (RLS: migrations/0003).
async function createPendingApproval(workspaceId: string, riskFlag: { severity?: string; text: string }, runState: Record<string, unknown>): Promise<string> {
  const id = "run-" + crypto.randomUUID();
  const departments = Array.isArray(runState.departments) ? (runState.departments as string[]) : [];
  await serviceRoleFetch("approvals", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspaceId,
      id,
      title: riskFlag.text,
      agent: "Risk & Compliance Agent",
      dept: departments.length ? departments.join(", ") : "Cross-functional",
      risk: riskFlag.severity || "High",
      status: "pending",
      run_state: runState,
    }),
  });
  return id;
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

// Shared per-agent context, threaded through runOneAgent for both a
// fresh run and a resumed one — so the two code paths can't drift.
type RunCtx = {
  apiKey: string;
  workspaceId: string;
  userId: string;
  objective: string;
  departments: string[];
  sources: string[];
  agentModels: Record<string, unknown>;
  autoRoute: boolean;
  autoRouteResult: ReturnType<typeof computeAutoRoute> | null;
  briefing: string;
  steps: Array<{ agentId: string; agentName: string; title: string; detail: string; riskFlag?: { severity: string; text: string } }>;
  totalInputTokens: number;
  totalOutputTokens: number;
  modelsUsed: Set<string>;
  substitutions: Array<{ agentId: string; agentName: string; requested: string; used: string }>;
};

type AgentOutcome =
  | { kind: "continue" }
  | { kind: "paused"; approvalId: string; riskFlag: { severity?: string; text: string }; policy: { autonomy: string; risk_threshold: number } }
  | { kind: "final"; result: { executiveSummary: string; steps: RunCtx["steps"]; findings: string[]; recommendations: unknown[]; riskFlags: string[] } };

function routingInfo(ctx: RunCtx) {
  return ctx.autoRouteResult
    ? { mode: "auto", tier: ctx.autoRouteResult.tier, matchedKeywords: ctx.autoRouteResult.matchedKeywords, complexityScore: ctx.autoRouteResult.complexityScore }
    : { mode: "manual" };
}

// Runs one agent's real Claude call, logs it, and appends its step.
// For the Risk & Compliance Agent specifically, also evaluates the
// workspace's Core-tier policy against its riskFlag — pausing the run
// (kind: "paused") if it crosses the gate, instead of letting Strategy
// and Writer run (and bill) unconditionally. Used by both a fresh run
// and handleResume's continuation, so the two can't diverge.
async function runOneAgent(agent: (typeof AGENT_DEFS)[number], ctx: RunCtx): Promise<AgentOutcome> {
  const isWriter = agent.id === "writer";
  const priorContext = ctx.steps.length
    ? "Prior agents' findings so far, in order:\n" +
      ctx.steps.map((s) => `- ${s.agentName}: ${s.title} — ${s.detail}`).join("\n")
    : "You are the first agent in this run — no prior findings yet.";

  const system = isWriter
    ? `You are the Executive Writer Agent in the Aiven Orchestrator, a governed multi-agent enterprise workflow. Your role: ${agent.role}. You are the last agent in a real six-agent pipeline — draft the final executive-ready synthesis from everything the other five agents actually found. Do not claim to have queried real live data yourself; this is a governed simulation run for a product demo, but be concrete and specific, grounded in the prior agents' stated findings. Call the submit_final_result tool exactly once.`
    : `You are the ${agent.name} in the Aiven Orchestrator, a governed multi-agent enterprise workflow. Your role: ${agent.role}. You are one agent in a real six-agent pipeline — see the prior agents' actual findings below and build on them where relevant (don't repeat what they already covered). Be concrete and specific — invent a plausible, clearly-illustrative finding, metric, or figure appropriate to the objective, as if you had actually queried the given data sources. Do not claim to have queried real live data; this is a governed simulation run for a product demo.${agent.id === "risk" ? " You MUST set riskFlag with exactly one realistic governance/compliance risk that would require human approval before anything ships externally." : " Leave riskFlag unset — that field is only for the Risk & Compliance Agent."} Call the submit_agent_step tool exactly once with your one finding.`;

  const user = `${ctx.briefing}\n\n${priorContext}`;

  const routed = ctx.autoRouteResult
    ? { modelId: ctx.autoRouteResult.modelsByAgent[agent.id] || agent.model, substitution: null }
    : resolveAgentModel(agent, ctx.agentModels[agent.id]);
  if (routed.substitution) ctx.substitutions.push(routed.substitution);

  const result = await callAgent({
    apiKey: ctx.apiKey,
    agentName: agent.name,
    model: routed.modelId,
    system,
    user,
    tool: isWriter ? FINAL_TOOL : STEP_TOOL,
    maxTokens: isWriter ? 4096 : 1024,
  });

  ctx.totalInputTokens += result.usage?.input_tokens || 0;
  ctx.totalOutputTokens += result.usage?.output_tokens || 0;
  ctx.modelsUsed.add(result.model || agent.model);

  await logCall(
    ctx.workspaceId, ctx.userId, agent.id, result.model || routed.modelId, result.usage,
    routed.substitution ? routed.substitution.requested : null,
  );

  if (isWriter) {
    const out = result.input || {};
    if (!out.title || !out.detail || !Array.isArray(out.findings) || !Array.isArray(out.recommendations) || !Array.isArray(out.riskFlags)) {
      throw new Error("Executive Writer Agent: returned an incomplete result.");
    }
    ctx.steps.push({ agentId: agent.id, agentName: agent.name, title: out.title, detail: out.detail });
    return {
      kind: "final",
      result: { executiveSummary: out.executiveSummary, steps: ctx.steps, findings: out.findings, recommendations: out.recommendations, riskFlags: out.riskFlags },
    };
  }

  const out = result.input || {};
  if (!out.title || !out.detail) {
    throw new Error(`${agent.name}: returned an incomplete result.`);
  }
  ctx.steps.push({
    agentId: agent.id,
    agentName: agent.name,
    title: out.title,
    detail: out.detail,
    ...(out.riskFlag && out.riskFlag.text ? { riskFlag: out.riskFlag } : {}),
  });

  if (agent.id === "risk" && out.riskFlag && out.riskFlag.text) {
    const policy = await getCompliancePolicy(ctx.workspaceId);
    if (shouldPauseForPolicy(policy, out.riskFlag)) {
      const runState = {
        objective: ctx.objective, departments: ctx.departments, sources: ctx.sources,
        agentModels: ctx.agentModels, autoRoute: ctx.autoRoute,
        steps: ctx.steps, totalInputTokens: ctx.totalInputTokens, totalOutputTokens: ctx.totalOutputTokens,
        modelsUsed: Array.from(ctx.modelsUsed), substitutions: ctx.substitutions,
      };
      const approvalId = await createPendingApproval(ctx.workspaceId, out.riskFlag, runState);
      return { kind: "paused", approvalId, riskFlag: out.riskFlag, policy: policy! };
    }
  }

  return { kind: "continue" };
}

// Continues a run that previously paused for policy approval. A pause
// only ever happens right after the Risk & Compliance Agent (index 3 of
// AGENT_DEFS) — Research/Finance/Ops/Risk already ran — so exactly
// Strategy and Writer remain; there's no arbitrary resume position to
// track. Requires the approval to belong to the caller's own workspace
// (the lookup below filters on it directly, since the service role key
// bypasses RLS) and to be approved and not already resumed.
async function handleResume(workspaceId: string, userId: string, approvalId: string, apiKey: string): Promise<Response> {
  const resp = await serviceRoleFetch(
    `approvals?workspace_id=eq.${workspaceId}&id=eq.${approvalId}&select=*`,
  );
  if (!resp.ok) return json({ error: "Failed to look up this approval." }, 500);
  const rows = await resp.json();
  const row = rows[0];
  if (!row) return json({ error: "Approval not found in your workspace." }, 404);
  if (row.status === "pending") {
    return json({ error: "This run is still pending approval — nothing to resume yet." }, 409);
  }
  if (row.status === "rejected") {
    return json({ rejected: true, error: "This run was rejected — no further Claude calls were made past the Risk & Compliance step." });
  }
  if (row.resumed_at) {
    return json({ error: "This run has already been resumed." }, 409);
  }

  const rs = row.run_state;
  if (!rs || !Array.isArray(rs.steps)) {
    return json({ error: "This approval has no run to resume." }, 400);
  }

  const objective = String(rs.objective || "");
  const departments: string[] = Array.isArray(rs.departments) ? rs.departments : [];
  const sources: string[] = Array.isArray(rs.sources) ? rs.sources : [];
  const agentModels = rs.agentModels && typeof rs.agentModels === "object" ? rs.agentModels : {};
  const autoRoute = rs.autoRoute === true;
  const briefing = `Business objective: ${objective}\nDepartments in scope: ${departments.join(", ") || "none specified"}\nData sources in scope: ${sources.join(", ") || "none specified"}`;

  const ctx: RunCtx = {
    apiKey, workspaceId, userId, objective, departments, sources, agentModels, autoRoute,
    autoRouteResult: autoRoute ? computeAutoRoute(objective, departments, sources) : null,
    briefing,
    steps: rs.steps.slice(),
    totalInputTokens: Number(rs.totalInputTokens) || 0,
    totalOutputTokens: Number(rs.totalOutputTokens) || 0,
    modelsUsed: new Set<string>(Array.isArray(rs.modelsUsed) ? rs.modelsUsed : []),
    substitutions: Array.isArray(rs.substitutions) ? rs.substitutions.slice() : [],
  };

  try {
    for (const agent of AGENT_DEFS.slice(4)) { // Strategy, Writer
      const outcome = await runOneAgent(agent, ctx);
      if (outcome.kind === "final") {
        await serviceRoleFetch(`approvals?workspace_id=eq.${workspaceId}&id=eq.${approvalId}`, {
          method: "PATCH",
          body: JSON.stringify({ resumed_at: new Date().toISOString() }),
        });
        // Usage was already recorded once, when this run paused (see the
        // "paused" branch in the main handler below) — resuming is a
        // continuation of that same logical run, not a second Orchestrate
        // call, so it must not count against the daily cap twice.
        const finalModel = Array.from(ctx.modelsUsed).join(" · ");
        await recordRun(ctx, outcome.result, finalModel, true, approvalId);
        return json({
          result: outcome.result,
          model: finalModel,
          usage: { input_tokens: ctx.totalInputTokens, output_tokens: ctx.totalOutputTokens },
          substitutions: ctx.substitutions,
          routing: routingInfo(ctx),
          resumedApprovalId: approvalId,
        });
      }
      // The Strategy/Writer prompts never set riskFlag (only the Risk
      // agent's does), so this can't recur here in practice — handled
      // anyway so a second real gate would still work, not get lost.
      if (outcome.kind === "paused") {
        return json({ paused: true, approvalId: outcome.approvalId, steps: ctx.steps, riskFlag: outcome.riskFlag, routing: routingInfo(ctx) });
      }
    }
    return json({ error: "Resumed orchestration ended without a final result." }, 502);
  } catch (err) {
    console.error("orchestrate: resume failed", err);
    return json({ error: String(err instanceof Error ? err.message : err) }, 502);
  }
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json(
      { error: "ANTHROPIC_API_KEY is not configured on this Edge Function. Add it in the Supabase dashboard: Project Settings → Edge Functions → Secrets." },
      500,
    );
  }

  // A resume request continues a previously paused run — it costs no
  // fresh rate-limit unit (the run it's finishing already checked the
  // cap before pausing) and needs none of the objective/departments/etc.
  // fields below, since those live in the paused approval's run_state.
  if (typeof body.resumeApprovalId === "string" && body.resumeApprovalId) {
    return await handleResume(workspaceId, userId, body.resumeApprovalId, apiKey);
  }

  const rateLimitError = await checkRateLimit(workspaceId);
  if (rateLimitError) {
    return json({ error: rateLimitError.error }, rateLimitError.status);
  }

  const objective = body.objective;
  const departments = Array.isArray(body.departments) ? body.departments as string[] : [];
  const sources = Array.isArray(body.sources) ? body.sources as string[] : [];
  const agentModels = body.agentModels && typeof body.agentModels === "object" ? body.agentModels as Record<string, unknown> : {};
  const autoRoute = body.autoRoute === true;
  if (!objective || typeof objective !== "string") {
    return json({ error: "`objective` (string) is required." }, 400);
  }

  const briefing = `Business objective: ${objective}\nDepartments in scope: ${departments.join(", ") || "none specified"}\nData sources in scope: ${sources.join(", ") || "none specified"}`;

  const ctx: RunCtx = {
    apiKey, workspaceId, userId, objective, departments, sources, agentModels, autoRoute,
    autoRouteResult: autoRoute ? computeAutoRoute(objective, departments, sources) : null,
    briefing,
    steps: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    modelsUsed: new Set<string>(),
    substitutions: [],
  };

  try {
    for (const agent of AGENT_DEFS) {
      const outcome = await runOneAgent(agent, ctx);
      if (outcome.kind === "paused") {
        // A pause still means Research/Finance/Ops/Risk already made 4
        // real, billed Anthropic calls — this must count against the
        // daily cap now, not only if/when the run is later resumed
        // (handleResume no longer records usage itself, so a run is
        // counted exactly once regardless of whether it ever resumes).
        await recordUsage(workspaceId, userId);
        return json({
          paused: true,
          approvalId: outcome.approvalId,
          steps: ctx.steps,
          riskFlag: outcome.riskFlag,
          policy: { autonomy: outcome.policy.autonomy, riskThreshold: outcome.policy.risk_threshold },
          routing: routingInfo(ctx),
        });
      }
      if (outcome.kind === "final") {
        await recordUsage(workspaceId, userId);
        const finalModel = Array.from(ctx.modelsUsed).join(" · ");
        await recordRun(ctx, outcome.result, finalModel, false, null);
        return json({
          result: outcome.result,
          model: finalModel,
          usage: { input_tokens: ctx.totalInputTokens, output_tokens: ctx.totalOutputTokens },
          substitutions: ctx.substitutions,
          routing: routingInfo(ctx),
        });
      }
      // "continue" — fall through to the next agent
    }
    // Unreachable — the loop always returns on the writer step — but
    // TypeScript wants every path to produce a Response.
    return json({ error: "Orchestration ended without a final result." }, 502);
  } catch (err) {
    console.error("orchestrate: pipeline failed", err);
    return json({ error: String(err instanceof Error ? err.message : err) }, 502);
  }
});
