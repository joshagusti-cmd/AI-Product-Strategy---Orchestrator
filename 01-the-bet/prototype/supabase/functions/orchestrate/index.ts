import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Aiven Orchestrator — real-model orchestration endpoint (Horizon 1 + 2).
// Makes real, independent Anthropic API calls — one per pipeline agent,
// run in the workspace's real Agent Registry order (Research → Finance
// → Ops → Risk & Compliance → Strategy → Executive Writer, by default)
// — each agent seeing the prior agents' actual output as context, not a
// single call asked to invent every step at once. The final call (the
// Writer) also synthesizes the run's executive summary, findings,
// recommendations, and risk flags from everything before it.
//
// The pipeline itself is data-driven (migrations/0016), not a hardcoded
// array: it's whichever rows in the workspace's real `agents` table
// (Agent Registry) have `sequence_order` set and `enabled = true`, in
// that order, with exactly one marked `is_writer` (must run last) and
// exactly one `is_risk_gate` (the one whose riskFlag the Core policy
// actually checks) — see loadPipelineAgents below. Editing the registry
// now genuinely changes what a real run does.
//
// Model per agent is real per-call routing, driven by a three-level
// fallback (see resolveAgentModel): an explicit per-run override (the
// Command Center's per-agent dropdown) beats the registry's own
// declared default model, which beats a fixed, always-real Claude
// default for that agent's role. Only "Claude Sonnet 5" and "Claude
// Opus 4.8" are real — no OpenAI/Google key is configured, so a
// registry default or per-run request for anything else (e.g. the
// seeded Finance/Strategy agents' "GPT-4o") falls back for real, every
// time, and the response's `substitutions` array tells the frontend
// exactly what ran instead, so the UI never silently claims a provider
// it isn't actually calling.
//
// Also enforces a per-workspace rolling 24h spend cap (each workspace's
// `daily_orchestrate_limit`, default 20) using the service role key —
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected into every
// Edge Function by Supabase, no manual secret needed for this part. The
// cap is looked up and logged server-side so a client can't raise its
// own limit or erase its own usage history to dodge it. One Orchestrate
// run still only costs one unit of quota, no matter how many real API
// calls the pipeline takes under the hood.
//
// Optional automatic model routing (`autoRoute: true` in the request
// body) replaces the manual per-agent `agentModels` selections with a
// real, deterministic cascade-by-risk decision — see computeAutoRoute
// below — the "cost-based automatic model routing" cascade this
// product's own pricing model (03-the-margin/cost-curve.md) describes,
// generalized by pipeline *slot* (gather / gate / synth / writer) so it
// still works whatever the registry's real agent count or order is.
//
// The Policy Editor's Core-tier policy (id: 'compliance') now actually
// gates this pipeline, instead of the policies table having no real
// consumer: if that policy's autonomy is "Approval-required" or
// "Two-gate" and the risk-gate agent's real risk flag scores at or
// above its risk_threshold, the run pauses right there — every agent
// after it (and their real API cost) doesn't run until a human
// approves it in the Approval Queue (or the Command Center's own
// approval panel). Rejecting it ends the run for real: no executive
// deliverable is ever generated. See shouldPauseForPolicy/
// createPendingApproval/handleResume below, and
// migrations/0011_policy_gated_approvals.sql.
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
//
// A workspace-wide emergency stop (migrations/0018) is checked first,
// before any of the above — one admin-flipped switch (the Workspace
// modal) that freezes both a fresh run and a resume until it's lifted.
// See checkEmergencyStop below.
//
// Real PII/secrets redaction runs on both sides of every real Anthropic
// call: the objective before it's ever prompted to an agent (input),
// and every agent's title/detail/summary/findings/recommendations/
// riskFlags text before it's stored or returned (output). See
// redactSensitive/mergeRedactions below and their call sites.
//
// The objective also gets real prompt-injection screening, before
// redaction and before anything else touches it: a deterministic
// pattern match for override/extraction phrasing (see
// screenPromptInjection below) neutralizes a matched span in place, so
// that text never reaches an agent's context, and logs a real,
// immediate audit_log entry — this only ever runs once, at intake, not
// per-agent like redaction.

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
type PipelineSlot = "gather" | "gate" | "synth" | "writer";

// Three-tier cascade mirroring the Leader/Filler/Killer cost model this
// whole product is built around: cheap model for routine, low-stakes
// work; escalate to a more capable model only where risk/complexity
// signals actually warrant the extra cost and latency. Keyed by pipeline
// *slot* rather than a fixed agent id, so this still works whatever the
// workspace's real Agent Registry pipeline shape is — every agent
// before the risk gate is "gather," the risk-gate agent itself is
// "gate," everything after it but before the writer is "synth," and the
// writer is "writer."
const AUTO_ROUTE_TIERS: Record<AutoTier, Record<PipelineSlot, string>> = {
  baseline: { gather: "claude-haiku-4-5", gate: "claude-sonnet-5", synth: "claude-sonnet-5", writer: "claude-sonnet-5" },
  elevated: { gather: "claude-sonnet-5", gate: "claude-opus-4-8", synth: "claude-sonnet-5", writer: "claude-sonnet-5" },
  high: { gather: "claude-sonnet-5", gate: "claude-opus-4-8", synth: "claude-opus-4-8", writer: "claude-opus-4-8" },
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

  return { tier, matchedKeywords, complexityScore, modelsBySlot: AUTO_ROUTE_TIERS[tier] };
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Real, real-time PII/secrets redaction — a deterministic pattern-match
// pass, not a claim of true PII detection, same honesty as the auto-route
// heuristic above. Runs on the objective before it ever reaches an agent
// (input) and on every agent's title/detail/summary/findings/
// recommendations/riskFlags text before they're stored or returned
// (output) — see redactSensitive/mergeRedactions below and their call
// sites in the main handler, handleResume, and runOneAgent. Matches are
// masked in place (never dropped silently) and every masked value is
// counted by type, merged into ctx.redactions, returned to the frontend
// (mirroring how `substitutions` already surfaces a silent model swap),
// and logged as a real audit_log entry (see logRedactions below) — a
// real, auditable finding, not a silent block.
type Redaction = { type: string; count: number };

// Order matters: SSN and the API-key prefixes are checked before the
// looser credit-card/email/phone patterns, so an already-redacted
// `[REDACTED:X]` marker (or part of one) can never itself be re-matched
// or partially eaten by a later, broader pattern.
const REDACTION_PATTERNS: Array<{ type: string; re: RegExp; validate?: (raw: string) => boolean }> = [
  { type: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    type: "API_KEY",
    re: /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|gh[opsu]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/g,
  },
  // Luhn-validated so a plain 13-19 digit run (an order number, a phone
  // number with no separators) isn't flagged as a card number just for
  // being the right length.
  { type: "CREDIT_CARD", re: /\b(?:\d[ -]?){13,19}\b/g, validate: (raw) => luhnValid(raw.replace(/[ -]/g, "")) },
  { type: "EMAIL", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { type: "PHONE", re: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
];

function luhnValid(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function redactSensitive(text: string): { text: string; redactions: Redaction[] } {
  if (!text) return { text: text || "", redactions: [] };
  const counts: Record<string, number> = {};
  let out = text;
  for (const { type, re, validate } of REDACTION_PATTERNS) {
    out = out.replace(re, (m) => {
      if (validate && !validate(m)) return m;
      counts[type] = (counts[type] || 0) + 1;
      return `[REDACTED:${type}]`;
    });
  }
  return { text: out, redactions: Object.keys(counts).map((type) => ({ type, count: counts[type] })) };
}

// Merges a fresh batch of redaction counts (e.g. from one agent's step)
// into the run's running total, in place — mirrors ctx.substitutions'
// own accumulate-as-you-go pattern.
function mergeRedactions(ctx: { redactions: Redaction[] }, found: Redaction[]) {
  for (const r of found) {
    const existing = ctx.redactions.find((x) => x.type === r.type);
    if (existing) existing.count += r.count;
    else ctx.redactions.push({ type: r.type, count: r.count });
  }
}

// Real prompt-injection screening on the objective — a real heuristic
// pass, same honesty as redactSensitive above and computeAutoRoute
// below: a deterministic pattern match for known override/extraction
// phrasing, not a claim of true intent classification. Runs once, on
// the raw objective, before it's ever redacted or prompted to any
// agent — a matched span is neutralized in place (never silently
// dropped) so the raw override text never reaches an agent's context,
// while the objective's real business content around it is untouched.
type InjectionFlag = { label: string; count: number };

// Deliberately narrow and specific (imperative override language,
// system-prompt extraction, chat-template markers, jailbreak framing)
// rather than broad terms like "act as" that would false-positive on
// ordinary business objectives ("act as the lead reviewer on this
// contract").
const PROMPT_INJECTION_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "instruction_override", re: /\b(?:ignore|disregard|forget)\b(?:[^.\n]{0,30}?)\b(?:previous|prior|above|earlier|all)\b(?:[^.\n]{0,20}?)\binstructions?\b/gi },
  { label: "role_override", re: /\byou are now\b/gi },
  { label: "new_instructions_marker", re: /\bnew instructions?\s*:/gi },
  { label: "system_prompt_extraction", re: /\b(?:reveal|print|show|output|repeat)\b(?:[^.\n]{0,20}?)\b(?:your |the )?system prompt\b/gi },
  { label: "prompt_leak_question", re: /\bwhat (?:is|was) your (?:system )?prompt\b/gi },
  { label: "chat_template_injection", re: /<\|im_(?:start|end)\|>|\[\s*system\s*\]/gi },
  { label: "role_marker_injection", re: /^\s*(?:system|assistant)\s*:/gim },
  { label: "jailbreak_framing", re: /\bjailbreak\b|\bdo anything now\b|\bDAN mode\b/gi },
  { label: "bypass_safety", re: /\b(?:bypass|disable|turn off)\b(?:[^.\n]{0,20}?)\b(?:safety|guardrails?|restrictions?|filters?|policy)\b/gi },
  { label: "unrestricted_persona", re: /\bact as (?:an? )?(?:unrestricted|uncensored|unfiltered)\b/gi },
];

function screenPromptInjection(text: string): { text: string; flags: InjectionFlag[] } {
  if (!text) return { text: text || "", flags: [] };
  const counts: Record<string, number> = {};
  let out = text;
  for (const { label, re } of PROMPT_INJECTION_PATTERNS) {
    out = out.replace(re, (m) => {
      counts[label] = (counts[label] || 0) + 1;
      return "[FLAGGED:PROMPT_INJECTION]";
    });
  }
  return { text: out, flags: Object.keys(counts).map((label) => ({ label, count: counts[label] })) };
}

// Real Claude model each dropdown/registry label maps to. The dropdown
// also offers "GPT-4o" and "Gemini 1.5 Pro" (illustrative multi-provider
// options from the original design) — neither has a real key configured,
// so they're deliberately absent here and any request for them falls
// back to the agent's safe default (see resolveAgentModel below).
const MODEL_LABEL_TO_ID: Record<string, string> = {
  "Claude Sonnet 5": "claude-sonnet-5",
  "Claude Opus 4.8": "claude-opus-4-8",
};

// One real pipeline agent, loaded from the workspace's own Agent
// Registry row (migrations/0016) rather than a hardcoded array.
type PipelineAgent = {
  id: string;
  name: string;
  declaredModel: string; // the registry's stated default label, e.g. "Claude Sonnet 5" — or, deliberately, "GPT-4o"
  role: string; // reused from the registry's own `can` column, which already held this exact prompt-role sentence
  isWriter: boolean;
  isRiskGate: boolean;
  slot: PipelineSlot;
};

// Loads the workspace's real, ordered pipeline from Agent Registry:
// every row with `sequence_order` set and `enabled = true`, in that
// order. Validates the structural invariants the rest of this file
// depends on (exactly one writer, exactly one risk gate, writer last)
// so a bad manual edit to the registry fails loudly and safely here,
// rather than silently running a broken or ungoverned pipeline.
async function loadPipelineAgents(workspaceId: string): Promise<PipelineAgent[] | { error: string }> {
  const resp = await serviceRoleFetch(
    `agents?workspace_id=eq.${workspaceId}&sequence_order=not.is.null&enabled=eq.true&select=id,name,model,can,is_writer,is_risk_gate&order=sequence_order.asc`,
  );
  if (!resp.ok) return { error: "Failed to load this workspace's Agent Registry pipeline." };
  const rows = await resp.json();
  if (!rows.length) {
    return { error: "This workspace's Agent Registry has no agents enabled in the real pipeline. Enable at least one in Agent Registry." };
  }
  if (rows.filter((r: { is_writer: boolean }) => r.is_writer).length !== 1) {
    return { error: "The real pipeline must have exactly one agent marked as the final Writer step — check Agent Registry." };
  }
  if (rows.filter((r: { is_risk_gate: boolean }) => r.is_risk_gate).length !== 1) {
    return { error: "The real pipeline must have exactly one agent marked as the Risk & Compliance gate — check Agent Registry." };
  }
  if (!rows[rows.length - 1].is_writer) {
    return { error: "The Writer agent must have the highest sequence order in Agent Registry — it has to run last." };
  }
  const gateIndex = rows.findIndex((r: { is_risk_gate: boolean }) => r.is_risk_gate);
  return rows.map((r: { id: string; name: string; model: string; can: string; is_writer: boolean; is_risk_gate: boolean }, i: number) => ({
    id: r.id,
    name: r.name,
    declaredModel: r.model,
    role: r.can,
    isWriter: r.is_writer,
    isRiskGate: r.is_risk_gate,
    slot: (r.is_writer ? "writer" : r.is_risk_gate ? "gate" : i < gateIndex ? "gather" : "synth") as PipelineSlot,
  }));
}

// The one fallback that can never itself be an unreal label, since it's
// not admin-editable: a fixed, always-real Claude model for this
// agent's structural role (Opus 4.8 for the risk gate — the
// highest-stakes step — Sonnet 5 for everything else).
function safeFallbackFor(agent: PipelineAgent): { modelId: string; label: string } {
  return agent.isRiskGate
    ? { modelId: "claude-opus-4-8", label: "Claude Opus 4.8" }
    : { modelId: "claude-sonnet-5", label: "Claude Sonnet 5" };
}

// Three-level resolution: an explicit per-run override beats the
// registry's own declared default, which beats the agent's safe
// fallback. A requested label with no real key configured — whether
// that request came from a per-run override or the registry's own
// default — falls all the way to the safe fallback and records a real
// substitution either way.
function resolveAgentModel(agent: PipelineAgent, requestedLabel: unknown) {
  if (typeof requestedLabel === "string" && MODEL_LABEL_TO_ID[requestedLabel]) {
    return { modelId: MODEL_LABEL_TO_ID[requestedLabel], label: requestedLabel, substitution: null as { agentId: string; agentName: string; requested: string; used: string } | null };
  }
  const fallback = safeFallbackFor(agent);
  const substitution = typeof requestedLabel === "string" && requestedLabel !== fallback.label
    ? { agentId: agent.id, agentName: agent.name, requested: requestedLabel, used: fallback.label }
    : null;
  return { modelId: fallback.modelId, label: fallback.label, substitution };
}

// Tool schema for every non-writer agent — just this agent's own step.
// `riskFlag` is only ever populated by the risk-gate agent (enforced by
// that agent's prompt, not by the schema, so the same tool works for
// every non-writer step).
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

// Workspace-wide emergency stop (migrations/0018) — the bigger, blunter
// sibling of the per-agent Enabled toggle in Agent Registry. An admin
// flips workspaces.emergency_stop via the set_emergency_stop RPC
// (assets/data.js setEmergencyStop, surfaced in the Workspace modal).
// Checked once, right after the workspace resolves, before either a
// fresh run or a resume can make a single further real Anthropic call.
// Fails open on a lookup error, same reasoning as getCompliancePolicy
// below — a transient read failure here must not silently wedge every
// future run in the workspace.
async function checkEmergencyStop(workspaceId: string): Promise<string | null> {
  const resp = await serviceRoleFetch(`workspaces?select=emergency_stop&id=eq.${workspaceId}`);
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows[0]?.emergency_stop
    ? "This workspace's emergency stop is active — Orchestrate is frozen (new runs and resuming a paused run both) until an admin turns it off in the Workspace panel."
    : null;
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

// Writes one real audit_log entry when redaction actually fired during
// this run — called once per real completion point (a pause or a final
// result), same cadence as recordUsage/recordRun above, so it's a real,
// queryable finding rather than only living in the response's toast.
async function logRedactions(workspaceId: string, redactions: Redaction[]) {
  if (!redactions.length) return;
  const summary = redactions.map((r) => `${r.count} ${r.type}`).join(", ");
  try {
    await serviceRoleFetch("audit_log", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: workspaceId,
        actor: "Aiven Orchestrator",
        action: "Redacted sensitive values before/after real agent calls",
        risk: "Medium",
        detail: `Masked ${summary} in this run's objective and/or agent output before it was sent to Claude or stored.`,
      }),
    });
  } catch (err) {
    // Telemetry must never break a real orchestration run.
    console.error("orchestrate: failed to log redactions", err);
  }
}

// Writes one real audit_log entry the moment prompt-injection screening
// flags the objective — logged immediately at intake (unlike
// logRedactions above, this only ever fires once, before the pipeline
// even starts, since the objective is screened exactly once regardless
// of whether the run later pauses or resumes) rather than waiting for a
// completion point. High severity: an actual override/extraction
// attempt in the objective is a more pointed signal than an
// incidentally-typed email address.
async function logPromptInjectionFlags(workspaceId: string, flags: InjectionFlag[]) {
  if (!flags.length) return;
  const summary = flags.map((f) => `${f.count} ${f.label}`).join(", ");
  try {
    await serviceRoleFetch("audit_log", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: workspaceId,
        actor: "Aiven Orchestrator",
        action: "Flagged possible prompt-injection language in the objective",
        risk: "High",
        detail: `Neutralized ${summary} before the objective was ever prompted to an agent.`,
      }),
    });
  } catch (err) {
    // Telemetry must never break a real orchestration run.
    console.error("orchestrate: failed to log prompt-injection flags", err);
  }
}

// Reads the workspace's Core-tier policy (id: 'compliance' — the tier
// every real pipeline agent belongs to; see migrations/0011). Returns
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
// single point, before the agents after the risk gate run.
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
  redactions: Redaction[];
  promptInjectionFlags: InjectionFlag[];
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

// Runs one agent's real Claude call, logs it, and appends its step. For
// the risk-gate agent specifically, also evaluates the workspace's
// Core-tier policy against its riskFlag — pausing the run
// (kind: "paused") if it crosses the gate, instead of letting the rest
// of the pipeline run (and bill) unconditionally. Used by both a fresh
// run and handleResume's continuation, so the two can't diverge.
async function runOneAgent(agent: PipelineAgent, ctx: RunCtx): Promise<AgentOutcome> {
  const isWriter = agent.isWriter;
  const priorContext = ctx.steps.length
    ? "Prior agents' findings so far, in order:\n" +
      ctx.steps.map((s) => `- ${s.agentName}: ${s.title} — ${s.detail}`).join("\n")
    : "You are the first agent in this run — no prior findings yet.";

  const system = isWriter
    ? `You are the Executive Writer Agent in the Aiven Orchestrator, a governed multi-agent enterprise workflow. Your role: ${agent.role}. You are the last agent in a real pipeline — draft the final executive-ready synthesis from everything the other agents actually found. Do not claim to have queried real live data yourself; this is a governed simulation run for a product demo, but be concrete and specific, grounded in the prior agents' stated findings. Call the submit_final_result tool exactly once.`
    : `You are the ${agent.name} in the Aiven Orchestrator, a governed multi-agent enterprise workflow. Your role: ${agent.role}. You are one agent in a real pipeline — see the prior agents' actual findings below and build on them where relevant (don't repeat what they already covered). Be concrete and specific — invent a plausible, clearly-illustrative finding, metric, or figure appropriate to the objective, as if you had actually queried the given data sources. Do not claim to have queried real live data; this is a governed simulation run for a product demo.${agent.isRiskGate ? " You MUST set riskFlag with exactly one realistic governance/compliance risk that would require human approval before anything ships externally." : " Leave riskFlag unset — that field is only for the Risk & Compliance Agent."} Call the submit_agent_step tool exactly once with your one finding.`;

  const user = `${ctx.briefing}\n\n${priorContext}`;

  const routed = ctx.autoRouteResult
    ? { modelId: ctx.autoRouteResult.modelsBySlot[agent.slot], substitution: null as { agentId: string; agentName: string; requested: string; used: string } | null }
    : resolveAgentModel(agent, ctx.agentModels[agent.id] ?? agent.declaredModel);
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
  ctx.modelsUsed.add(result.model || routed.modelId);

  await logCall(
    ctx.workspaceId, ctx.userId, agent.id, result.model || routed.modelId, result.usage,
    routed.substitution ? routed.substitution.requested : null,
  );

  if (isWriter) {
    const out = result.input || {};
    if (!out.title || !out.detail || !Array.isArray(out.findings) || !Array.isArray(out.recommendations) || !Array.isArray(out.riskFlags)) {
      throw new Error("Executive Writer Agent: returned an incomplete result.");
    }
    // Output redaction — the writer's synthesized deliverable is what a
    // human actually reads and what gets archived/exported, so every
    // text field it can carry PII/secrets in gets the same real pass the
    // objective (input) already went through.
    const title = redactSensitive(out.title);
    const detail = redactSensitive(out.detail);
    const executiveSummary = redactSensitive(out.executiveSummary || "");
    const findings = (out.findings as string[]).map((f) => redactSensitive(f));
    const recommendations = (out.recommendations as Array<{ text: string; owner: string; nextStep: string; priority: string }>).map((r) => ({
      ...r,
      text: redactSensitive(r.text).text,
      nextStep: redactSensitive(r.nextStep).text,
    }));
    const riskFlags = (out.riskFlags as string[]).map((f) => redactSensitive(f));
    mergeRedactions(ctx, [
      ...title.redactions, ...detail.redactions, ...executiveSummary.redactions,
      ...findings.flatMap((f) => f.redactions), ...riskFlags.flatMap((f) => f.redactions),
    ]);
    ctx.steps.push({ agentId: agent.id, agentName: agent.name, title: title.text, detail: detail.text });
    return {
      kind: "final",
      result: {
        executiveSummary: executiveSummary.text, steps: ctx.steps,
        findings: findings.map((f) => f.text), recommendations, riskFlags: riskFlags.map((f) => f.text),
      },
    };
  }

  const out = result.input || {};
  if (!out.title || !out.detail) {
    throw new Error(`${agent.name}: returned an incomplete result.`);
  }
  const title = redactSensitive(out.title);
  const detail = redactSensitive(out.detail);
  const riskFlagText = out.riskFlag && out.riskFlag.text ? redactSensitive(out.riskFlag.text) : null;
  mergeRedactions(ctx, [...title.redactions, ...detail.redactions, ...(riskFlagText ? riskFlagText.redactions : [])]);
  const riskFlag = out.riskFlag && riskFlagText ? { ...out.riskFlag, text: riskFlagText.text } : out.riskFlag;
  ctx.steps.push({
    agentId: agent.id,
    agentName: agent.name,
    title: title.text,
    detail: detail.text,
    ...(riskFlag && riskFlag.text ? { riskFlag } : {}),
  });

  if (agent.isRiskGate && riskFlag && riskFlag.text) {
    const policy = await getCompliancePolicy(ctx.workspaceId);
    if (shouldPauseForPolicy(policy, riskFlag)) {
      const runState = {
        objective: ctx.objective, departments: ctx.departments, sources: ctx.sources,
        agentModels: ctx.agentModels, autoRoute: ctx.autoRoute,
        steps: ctx.steps, totalInputTokens: ctx.totalInputTokens, totalOutputTokens: ctx.totalOutputTokens,
        modelsUsed: Array.from(ctx.modelsUsed), substitutions: ctx.substitutions, redactions: ctx.redactions,
        promptInjectionFlags: ctx.promptInjectionFlags,
      };
      const approvalId = await createPendingApproval(ctx.workspaceId, riskFlag, runState);
      return { kind: "paused", approvalId, riskFlag, policy: policy! };
    }
  }

  return { kind: "continue" };
}

// Continues a run that previously paused for policy approval. A pause
// only ever happens right after the workspace's risk-gate agent — every
// agent before it already ran — so what remains is every real pipeline
// agent after the risk gate, in the *current* registry order. If the
// registry changed between pause and resume (an admin reordered or
// disabled something), loadPipelineAgents' own validation below still
// applies — a now-invalid pipeline fails this resume loudly rather than
// silently running something ungoverned. Requires the approval to
// belong to the caller's own workspace (the lookup below filters on it
// directly, since the service role key bypasses RLS) and to be approved
// and not already resumed.
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

  const pipeline = await loadPipelineAgents(workspaceId);
  if ("error" in pipeline) return json({ error: pipeline.error }, 500);
  const gateIndex = pipeline.findIndex((a) => a.isRiskGate);
  const remaining = pipeline.slice(gateIndex + 1);
  if (!remaining.length) {
    return json({ error: "Nothing to resume — the risk-gate agent is the last enabled step in Agent Registry." }, 500);
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
    // The objective was already redacted once, before it was ever stored
    // in run_state at pause time — carrying forward what was already
    // found, not re-scanning already-redacted `[REDACTED:X]` text.
    redactions: Array.isArray(rs.redactions) ? rs.redactions.slice() : [],
    // Same reasoning: prompt-injection screening only ever runs once, at
    // objective intake in the main handler — carry forward what it found.
    promptInjectionFlags: Array.isArray(rs.promptInjectionFlags) ? rs.promptInjectionFlags.slice() : [],
  };
  // Snapshot so logRedactions below logs only what THIS resume newly
  // found, not the pre-pause counts again — those were already logged
  // once, in the main handler's own "paused" branch.
  const preResumeCounts: Record<string, number> = {};
  for (const r of ctx.redactions) preResumeCounts[r.type] = r.count;
  function newRedactionsSinceResume(): Redaction[] {
    return ctx.redactions
      .map((r) => ({ type: r.type, count: r.count - (preResumeCounts[r.type] || 0) }))
      .filter((r) => r.count > 0);
  }

  try {
    for (const agent of remaining) {
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
        await logRedactions(workspaceId, newRedactionsSinceResume());
        return json({
          result: outcome.result,
          model: finalModel,
          usage: { input_tokens: ctx.totalInputTokens, output_tokens: ctx.totalOutputTokens },
          substitutions: ctx.substitutions,
          routing: routingInfo(ctx),
          resumedApprovalId: approvalId,
          redactions: ctx.redactions,
          promptInjectionFlags: ctx.promptInjectionFlags,
        });
      }
      // A real pipeline could in principle have a second risk-gate-like
      // pause after the first (e.g. a registry reordered to put the gate
      // earlier) — handled anyway so a second real gate would still
      // work, not get lost.
      if (outcome.kind === "paused") {
        await logRedactions(workspaceId, newRedactionsSinceResume());
        return json({ paused: true, approvalId: outcome.approvalId, steps: ctx.steps, riskFlag: outcome.riskFlag, routing: routingInfo(ctx), redactions: ctx.redactions, promptInjectionFlags: ctx.promptInjectionFlags });
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

  const stopError = await checkEmergencyStop(workspaceId);
  if (stopError) return json({ error: stopError }, 423);

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

  const pipeline = await loadPipelineAgents(workspaceId);
  if ("error" in pipeline) {
    return json({ error: pipeline.error }, 500);
  }

  const rawObjective = body.objective;
  const departments = Array.isArray(body.departments) ? body.departments as string[] : [];
  const sources = Array.isArray(body.sources) ? body.sources as string[] : [];
  const agentModels = body.agentModels && typeof body.agentModels === "object" ? body.agentModels as Record<string, unknown> : {};
  const autoRoute = body.autoRoute === true;
  if (!rawObjective || typeof rawObjective !== "string") {
    return json({ error: "`objective` (string) is required." }, 400);
  }

  // Prompt-injection screening runs first, on the raw objective, before
  // redaction — neutralizing an override/extraction attempt before any
  // other processing touches the text. Logged immediately, not held
  // until a completion point (see logPromptInjectionFlags above).
  const injectionScreen = screenPromptInjection(rawObjective);
  await logPromptInjectionFlags(workspaceId, injectionScreen.flags);

  // Input redaction — the objective is the one piece of this request a
  // caller actually typed by hand, so it's the one real input surface
  // for PII/secrets to land on. Redacted once, here, before it's ever
  // used to route, prompt an agent, or get archived — everything
  // downstream (routing, briefing, orchestrate_runs.objective) only
  // ever sees the redacted (and injection-screened) version.
  const objectiveRedaction = redactSensitive(injectionScreen.text);
  const objective = objectiveRedaction.text;

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
    redactions: objectiveRedaction.redactions.slice(),
    promptInjectionFlags: injectionScreen.flags.slice(),
  };

  try {
    for (const agent of pipeline) {
      const outcome = await runOneAgent(agent, ctx);
      if (outcome.kind === "paused") {
        // A pause still means every agent before the gate already made
        // real, billed Anthropic calls — this must count against the
        // daily cap now, not only if/when the run is later resumed
        // (handleResume no longer records usage itself, so a run is
        // counted exactly once regardless of whether it ever resumes).
        await recordUsage(workspaceId, userId);
        await logRedactions(workspaceId, ctx.redactions);
        return json({
          paused: true,
          approvalId: outcome.approvalId,
          steps: ctx.steps,
          riskFlag: outcome.riskFlag,
          policy: { autonomy: outcome.policy.autonomy, riskThreshold: outcome.policy.risk_threshold },
          routing: routingInfo(ctx),
          redactions: ctx.redactions,
          promptInjectionFlags: ctx.promptInjectionFlags,
        });
      }
      if (outcome.kind === "final") {
        await recordUsage(workspaceId, userId);
        const finalModel = Array.from(ctx.modelsUsed).join(" · ");
        await recordRun(ctx, outcome.result, finalModel, false, null);
        await logRedactions(workspaceId, ctx.redactions);
        return json({
          result: outcome.result,
          model: finalModel,
          usage: { input_tokens: ctx.totalInputTokens, output_tokens: ctx.totalOutputTokens },
          substitutions: ctx.substitutions,
          routing: routingInfo(ctx),
          redactions: ctx.redactions,
          promptInjectionFlags: ctx.promptInjectionFlags,
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
