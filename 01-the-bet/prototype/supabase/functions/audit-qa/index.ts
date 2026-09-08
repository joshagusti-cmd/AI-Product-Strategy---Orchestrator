import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Aiven Orchestrator — natural-language audit trail Q&A.
//
// A real Claude call, grounded strictly in this workspace's own real
// audit_log rows — "why did the Risk agent flag this?" answered from
// what's actually in the log, not a canned demo answer. The system
// prompt instructs the model to answer only from the rows it's given
// and say so explicitly when the log doesn't support an answer, rather
// than inventing an actor, action, or timestamp that isn't there.
//
// Self-contained, like functions/orchestrate/ — this repo has no
// shared-imports setup between Edge Functions, so the small set of
// helpers below (JWT parsing, service-role fetch, workspace resolution)
// is deliberately duplicated rather than shared.
//
// Gated to signed-in users (this is a real, metered API call) and rate
// limited per workspace over a rolling 24h window — same shape as
// Orchestrate's cap (migrations/0006) but its own table and its own
// fixed limit (migrations/0014_audit_qa.sql), since this is a much
// cheaper, different kind of real Claude usage, not tied to the plan
// tiers Orchestrate's cap uses.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DAILY_QUESTION_LIMIT = 40;
const MAX_LOG_ROWS = 300;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

async function serviceRoleFetch(path: string, init: RequestInit = {}) {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY!,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function resolveWorkspaceId(userId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await serviceRoleFetch(`workspace_members?select=workspace_id&user_id=eq.${userId}&limit=1`);
    if (resp.ok) {
      const rows = await resp.json();
      if (rows.length) return rows[0].workspace_id;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  return null;
}

// Same shape as Orchestrate's checkRateLimit, but against audit_qa_log
// and a fixed limit rather than the plan-tied daily_orchestrate_limit —
// this is a different, much cheaper real Claude usage surface.
async function checkQuestionLimit(workspaceId: string): Promise<{ error: string; status: number } | null> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const countResp = await serviceRoleFetch(
    `audit_qa_log?select=id&workspace_id=eq.${workspaceId}&created_at=gte.${since}`,
    { headers: { Prefer: "count=exact" } },
  );
  if (!countResp.ok) return { error: "Failed to check today's question usage.", status: 500 };
  const contentRange = countResp.headers.get("content-range");
  const used = contentRange ? parseInt(contentRange.split("/")[1], 10) : (await countResp.json()).length;
  if (used >= DAILY_QUESTION_LIMIT) {
    return {
      error: `This workspace has asked its limit of ${DAILY_QUESTION_LIMIT} audit trail questions for today. The cap resets on a rolling basis — try again later.`,
      status: 429,
    };
  }
  return null;
}

async function logQa(
  workspaceId: string,
  userId: string,
  question: string,
  answer: string,
  logRowsConsidered: number,
  model: string,
  usage: { input_tokens?: number; output_tokens?: number } | undefined,
) {
  try {
    await serviceRoleFetch("audit_qa_log", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: workspaceId,
        user_id: userId,
        question,
        answer,
        log_rows_considered: logRowsConsidered,
        model,
        input_tokens: usage?.input_tokens || 0,
        output_tokens: usage?.output_tokens || 0,
      }),
    });
  } catch (err) {
    console.error("audit-qa: failed to log Q&A", err);
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
      { error: "Sign in to ask the audit trail a question — this triggers a real, metered Claude API call and is limited to signed-in workspaces. The public demo data is view-only." },
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
  const question = body.question;
  if (!question || typeof question !== "string" || !question.trim()) {
    return json({ error: "`question` (non-empty string) is required." }, 400);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return json(
      { error: "ANTHROPIC_API_KEY is not configured on this Edge Function. Add it in the Supabase dashboard: Project Settings → Edge Functions → Secrets." },
      500,
    );
  }

  const limitError = await checkQuestionLimit(workspaceId);
  if (limitError) {
    return json({ error: limitError.error }, limitError.status);
  }

  const logResp = await serviceRoleFetch(
    `audit_log?select=ts,actor,action,model,risk,detail&workspace_id=eq.${workspaceId}&order=ts.desc&limit=${MAX_LOG_ROWS}`,
  );
  if (!logResp.ok) {
    return json({ error: "Failed to read the audit trail." }, 500);
  }
  const logRows: Array<{ ts: string; actor: string; action: string; model: string | null; risk: string | null; detail: string | null }> = await logResp.json();

  if (!logRows.length) {
    return json({
      answer: "There's nothing in this workspace's audit trail yet — run an Orchestrate pass, save a policy, or decide an approval, and it'll show up here to ask about.",
      model: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      logRowsConsidered: 0,
    });
  }

  // Oldest-first in the prompt so the model reads it as a timeline, even
  // though it was fetched newest-first (the cap that matters).
  const logText = logRows.slice().reverse().map((r) => {
    const parts = [r.ts, r.actor, r.action];
    if (r.model) parts.push(`model: ${r.model}`);
    if (r.risk) parts.push(`risk: ${r.risk}`);
    if (r.detail) parts.push(`detail: ${r.detail}`);
    return "- " + parts.join(" | ");
  }).join("\n");

  const system = `You are answering a question about a real enterprise audit trail for the Aiven Orchestrator. Below are the ${logRows.length} most recent real log entries for this workspace, oldest first, each as "timestamp | actor | action | model: … | risk: … | detail: …" (model/risk/detail omitted when not recorded for that entry).

Answer strictly from these entries. If they support a clear answer, give it concisely and cite the specific entry/entries you're drawing from (actor + action, and timestamp if it matters). If they DON'T support an answer — the question asks about something not covered by these ${logRows.length} entries, or asks you to speculate beyond what's logged — say so plainly rather than inventing an actor, action, timestamp, or reason that isn't in the log. Never fabricate a log entry.

Audit trail (oldest first):
${logText}`;

  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 700,
        system,
        messages: [{ role: "user", content: question }],
      }),
    });
  } catch (err) {
    return json({ error: `Failed to reach Anthropic API: ${String(err)}` }, 502);
  }

  if (!resp.ok) {
    const text = await resp.text();
    console.error("audit-qa: Anthropic API error", resp.status, text);
    return json({ error: `Anthropic API error (${resp.status})` }, 502);
  }

  const data = await resp.json();
  const textBlock = (data.content || []).find((b: { type: string }) => b.type === "text");
  const answer = textBlock ? textBlock.text : "The model didn't return a text answer — try rephrasing the question.";

  await logQa(workspaceId, userId, question.trim(), answer, logRows.length, data.model || "claude-sonnet-5", data.usage);

  return json({
    answer,
    model: data.model || "claude-sonnet-5",
    usage: { input_tokens: data.usage?.input_tokens || 0, output_tokens: data.usage?.output_tokens || 0 },
    logRowsConsidered: logRows.length,
  });
});
