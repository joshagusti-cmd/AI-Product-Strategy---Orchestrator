import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Aiven Orchestrator — universal external-agent connector.
//
// Lets a workspace register an agent it already runs somewhere else —
// any stack, any language — and have it report real activity into the
// same Audit Trail, Agent Registry, and Approval Queue an internal
// Claude agent uses. Aiven never executes an external agent; it can
// only ever observe what that agent's own code chooses to report, and
// gate one of its actions only if that code calls this endpoint's
// check_approval action and actually honors the answer — the same
// honest limit every real governance platform has for something it
// doesn't run itself.
//
// A workspace-wide emergency stop (migrations/0018) is also checked on
// every call here — the same real flag orchestrate/index.ts checks for
// internal runs. See isEmergencyStopped below.
//
// Authenticated by the agent's own API key (generated client-side, once,
// at registration in agents.html — see assets/data.js
// registerExternalAgent), not a Supabase user session: the caller here
// is someone else's backend code, which has no Supabase login. Only the
// key's SHA-256 hash is ever stored (migrations/0017_external_agent_
// connector.sql); this function hashes the incoming key the same way
// and looks up the matching row. Self-contained, like functions/
// orchestrate/ and functions/audit-qa/ — this repo has no shared-
// imports setup between Edge Functions.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
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

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type ResolvedAgent = { workspaceId: string; agentId: string; agentName: string; dept: string };

// Resolves which workspace + agent row a raw API key belongs to. Never
// looks up by workspace first — the key itself IS the identity, same
// as any bearer-token API.
async function resolveAgentByKey(apiKey: string): Promise<ResolvedAgent | null> {
  const hash = await sha256Hex(apiKey);
  const resp = await serviceRoleFetch(
    `agents?external_key_hash=eq.${hash}&agent_type=eq.external&select=workspace_id,id,name,dept`,
  );
  if (!resp.ok) return null;
  const rows = await resp.json();
  if (!rows.length) return null;
  return { workspaceId: rows[0].workspace_id, agentId: rows[0].id, agentName: rows[0].name, dept: rows[0].dept };
}

// Same real gate every internal pipeline agent's risk flag goes
// through (orchestrate/index.ts) — an external agent's flag is judged
// by the identical Core-tier policy, not a separate, lesser rule.
const RISK_SEVERITY_SCORE: Record<string, number> = { Low: 25, Medium: 60, High: 90 };

async function getCompliancePolicy(workspaceId: string): Promise<{ autonomy: string; risk_threshold: number } | null> {
  const resp = await serviceRoleFetch(`policies?select=autonomy,risk_threshold&workspace_id=eq.${workspaceId}&id=eq.compliance`);
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows[0] || null;
}

function shouldPause(policy: { autonomy: string; risk_threshold: number } | null, severity: string | undefined): boolean {
  if (!policy) return false;
  if (policy.autonomy !== "Approval-required" && policy.autonomy !== "Two-gate") return false;
  const score = RISK_SEVERITY_SCORE[severity || ""] || 0;
  return score >= policy.risk_threshold;
}

// Workspace-wide emergency stop (migrations/0018) — checked for every
// call this function gets, using the same real flag orchestrate/index.ts
// checks for internal runs. Two real effects here: check_approval always
// answers "not yet" while it's active, regardless of the approval's
// actual status, and any risk flag reported while it's active gets
// gated on the spot, regardless of whether it would normally cross the
// Core policy's threshold — the same "when in doubt, freeze" stance the
// internal pipeline gets from being blocked outright. This still can't
// reach into an external agent's own code (see the file header) — it
// only makes the real answer available the moment that code asks.
async function isEmergencyStopped(workspaceId: string): Promise<boolean> {
  const resp = await serviceRoleFetch(`workspaces?select=emergency_stop&id=eq.${workspaceId}`);
  if (!resp.ok) return false;
  const rows = await resp.json();
  return !!rows[0]?.emergency_stop;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Use POST." }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const apiKey = body.apiKey;
  if (!apiKey || typeof apiKey !== "string") {
    return json({ error: "`apiKey` (string) is required — the key shown once when this agent was registered in Agent Registry." }, 400);
  }
  const agent = await resolveAgentByKey(apiKey);
  if (!agent) {
    return json({ error: "Unknown or revoked API key." }, 401);
  }

  // check_approval: a real, poll-based gate check. An external agent
  // that reported a risk flag and got gated (see below) is expected to
  // call this — possibly more than once, waiting on a human — before
  // actually taking the action it asked permission for. Aiven can't
  // force that call to happen; it can only make the real answer
  // available the moment it's asked.
  if (body.action === "check_approval") {
    const approvalId = body.approvalId;
    if (!approvalId || typeof approvalId !== "string") {
      return json({ error: "`approvalId` (string) is required." }, 400);
    }
    if (await isEmergencyStopped(agent.workspaceId)) {
      // Deliberately reports "pending" even if the real row says
      // "approved" — while the workspace is frozen, the one honest
      // answer for a well-behaved agent to act on is "not yet."
      return json({ status: "pending", emergencyStop: true });
    }
    const resp = await serviceRoleFetch(`approvals?workspace_id=eq.${agent.workspaceId}&id=eq.${approvalId}&select=status`);
    if (!resp.ok) return json({ error: "Failed to look up that approval." }, 500);
    const rows = await resp.json();
    if (!rows.length) return json({ error: "Approval not found in this agent's workspace." }, 404);
    return json({ status: rows[0].status });
  }

  // Default action: report real activity. `riskFlag`, if present, is
  // evaluated against the exact same Core-tier policy the internal
  // pipeline uses — if it crosses the threshold, a real approvals row
  // is created (same table, same Approval Queue a human already
  // watches) and `gated: true` is returned. The external agent's own
  // code decides what to do with that; Aiven has no way to stop it
  // from proceeding anyway if it chooses to ignore the answer.
  const title = body.title;
  if (!title || typeof title !== "string") {
    return json({ error: "`title` (string) is required." }, 400);
  }
  const detail = typeof body.detail === "string" ? body.detail : null;
  const riskFlag = body.riskFlag && typeof body.riskFlag === "object"
    ? body.riskFlag as { severity?: string; text?: string }
    : null;

  await serviceRoleFetch(`agents?workspace_id=eq.${agent.workspaceId}&id=eq.${agent.agentId}`, {
    method: "PATCH",
    body: JSON.stringify({ external_last_seen_at: new Date().toISOString() }),
  });

  const stopped = await isEmergencyStopped(agent.workspaceId);

  let approvalId: string | null = null;
  let gated = false;
  if (riskFlag && riskFlag.severity && riskFlag.text) {
    const policy = stopped ? null : await getCompliancePolicy(agent.workspaceId);
    if (stopped || shouldPause(policy, riskFlag.severity)) {
      gated = true;
      approvalId = "ext-" + crypto.randomUUID();
      await serviceRoleFetch("approvals", {
        method: "POST",
        body: JSON.stringify({
          workspace_id: agent.workspaceId,
          id: approvalId,
          title: riskFlag.text,
          agent: agent.agentName,
          dept: agent.dept || "Cross-functional",
          risk: riskFlag.severity,
          status: "pending",
        }),
      });
    }
  }

  await serviceRoleFetch("agent_events", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: agent.workspaceId,
      agent_id: agent.agentId,
      event_type: riskFlag ? "risk_flag" : "activity",
      title,
      detail,
      risk_severity: riskFlag?.severity || null,
      risk_text: riskFlag?.text || null,
      approval_id: approvalId,
    }),
  });

  // Mirrored into audit_log too, so this shows up in the existing
  // Audit Trail UI immediately — no separate "external events" view to
  // build or remember to check.
  await serviceRoleFetch("audit_log", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: agent.workspaceId,
      actor: agent.agentName,
      action: title,
      model: null,
      risk: riskFlag?.severity || null,
      detail: gated ? [detail, "Paused for approval before proceeding."].filter(Boolean).join(" — ") : detail,
    }),
  });

  return json({ ok: true, gated, approvalId, emergencyStop: stopped });
});
