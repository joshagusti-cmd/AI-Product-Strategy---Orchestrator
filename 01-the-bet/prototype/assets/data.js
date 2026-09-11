/* =========================================================================
   Aiven Orchestrator — shared backend client + auth + chrome (Horizon 2)

   Real, persistent Postgres via Supabase, now with real multi-tenancy:
   - A public "Demo Workspace" is readable by anyone (anon key), but only
     writable by its own signed-in members — i.e. read-only for anonymous
     visitors. This is the shared demo everyone sees by default.
   - Signing in (email magic link, no password) auto-provisions a private
     workspace for that user (pre-seeded with the standard agent roster +
     policies, clean activity history) and every read/write scopes to it
     instead of the demo.
   - Orchestrating (a real, metered Claude call) requires a signed-in
     session — the Edge Function itself rejects anonymous requests.
   - Teams: a workspace member can invite a teammate by email (the
     "Team" button in the auth widget). An invited teammate joins that
     workspace automatically on their next sign-in — a user can belong
     to more than one workspace now, switchable via the workspace
     dropdown that appears once they do.
   ========================================================================= */
(function (global) {
  "use strict";

  var SUPABASE_URL = "https://uqgdruekuwitjwyotdud.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_p18dpRJSewtzNn0mLS4GCw_4A3p1qLJ";
  var ORCHESTRATE_FUNCTION_URL = SUPABASE_URL + "/functions/v1/orchestrate";
  var AUDIT_QA_FUNCTION_URL = SUPABASE_URL + "/functions/v1/audit-qa";
  var AGENT_EVENTS_FUNCTION_URL = SUPABASE_URL + "/functions/v1/agent-events";
  var DEMO_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";

  if (!global.supabase || !global.supabase.createClient) {
    console.error("Aiven: supabase-js failed to load — check the CDN <script> tag on this page.");
  }
  var sb = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  /* ---------------- auth / workspace state ---------------- */
  var currentUser = null;
  var currentWorkspaceId = DEMO_WORKSPACE_ID;
  var currentWorkspaces = []; // every workspace this user belongs to: [{ id, name, role }]
  var authListeners = [];
  var resolveReady;
  var ready = new Promise(function (res) { resolveReady = res; });

  function rememberedWorkspaceId(userId) {
    try { return global.localStorage.getItem("aiven_ws_" + userId); } catch (e) { return null; }
  }
  function rememberWorkspaceId(userId, wsId) {
    try { global.localStorage.setItem("aiven_ws_" + userId, wsId); } catch (e) { /* private browsing, etc. — non-critical */ }
  }

  // Every workspace a signed-in user belongs to (now that teams/invites
  // means that can be more than one — see migrations/0007). Retries
  // briefly since the auto-provision trigger (or an invite being
  // accepted) can still be racing this request right after sign-in.
  async function resolveMemberships(userId) {
    for (var attempt = 0; attempt < 3; attempt++) {
      var r = await sb.from("workspace_members")
        .select("workspace_id, role, created_at, workspaces(name)")
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (r.error) throw r.error;
      if (r.data && r.data.length) {
        return r.data.map(function (row) {
          return { id: row.workspace_id, name: row.workspaces ? row.workspaces.name : row.workspace_id, role: row.role };
        });
      }
      await new Promise(function (res) { setTimeout(res, 600); });
    }
    return [];
  }

  async function handleAuthChange(session) {
    var user = session && session.user ? session.user : null;
    currentUser = user;
    currentWorkspaces = [];
    if (user) {
      try {
        // Picks up any invite sent to this email after they'd already
        // signed up once (the signup trigger only runs at account
        // creation) — safe to call even if there's nothing pending.
        try { await sb.rpc("accept_pending_invites"); } catch (e) { console.error("Aiven: accept_pending_invites failed", e); }

        var memberships = await resolveMemberships(user.id);
        currentWorkspaces = memberships;
        var remembered = rememberedWorkspaceId(user.id);
        var match = memberships.find(function (m) { return m.id === remembered; });
        currentWorkspaceId = (match || memberships[0] || {}).id || DEMO_WORKSPACE_ID;
      } catch (e) {
        console.error("Aiven: failed to resolve workspace for signed-in user", e);
        currentWorkspaceId = DEMO_WORKSPACE_ID;
      }
    } else {
      currentWorkspaceId = DEMO_WORKSPACE_ID;
    }
    authListeners.forEach(function (fn) { try { fn(currentUser, currentWorkspaceId); } catch (e) { console.error(e); } });
  }

  // Switches the active workspace among the ones this user belongs to.
  // Reloads the page — simplest way to get every already-initialized
  // page script (which reads Aiven.loadState() once at startup) to
  // re-read against the new workspace, matching how sign-out already
  // reloads rather than trying to live-patch every page's state.
  function switchWorkspace(wsId) {
    if (!currentUser) return;
    rememberWorkspaceId(currentUser.id, wsId);
    global.location.reload();
  }

  sb.auth.onAuthStateChange(function (_event, session) {
    handleAuthChange(session).then(resolveReady, resolveReady);
  });

  function requireOwnWorkspace() {
    if (currentWorkspaceId === DEMO_WORKSPACE_ID) {
      throw new Error("Sign in to make changes — you're viewing the read-only public demo.");
    }
  }

  /* ---------------- RBAC ---------------- */
  // Three roles, matching the governance model in
  // 05-the-guardrails/compounding-system.md. Enforced for real at the
  // RLS layer (migrations/0008) — this mirror is for the UI to
  // hide/disable controls a caller can't use, not the source of truth.
  var ROLE_LABELS = { admin: "Admin", compliance_owner: "Compliance Owner", analyst: "Analyst" };
  function roleLabel(role) { return ROLE_LABELS[role] || role; }
  function getRole() {
    var ws = currentWorkspaces.find(function (w) { return w.id === currentWorkspaceId; });
    return ws ? ws.role : null;
  }
  function isAdmin() { return getRole() === "admin"; }
  function isComplianceOwner() { return getRole() === "admin" || getRole() === "compliance_owner"; }

  // RLS silently filters an UPDATE/DELETE a caller's role doesn't
  // permit — no rows change, but (unlike an INSERT's WITH CHECK) no
  // error is raised either. Call this after a gated update/delete
  // (with .select() chained so `rows` reflects what actually changed)
  // to turn "0 rows, no error" into a real, catchable permission error
  // instead of a false-success toast.
  function assertRowsChanged(rows, action) {
    if (!rows || !rows.length) {
      throw new Error("You don't have permission to " + action + " — ask a workspace admin.");
    }
  }

  /* ---------------- mapping: DB rows -> the shape the pages expect ---------------- */
  function mapPolicy(row) {
    return {
      id: row.id, tier: row.tier, label: row.label, autonomy: row.autonomy,
      riskThreshold: row.risk_threshold, escalation: row.escalation,
      updatedAt: row.updated_at ? row.updated_at.slice(0, 10) : ""
    };
  }
  function mapApproval(row) {
    return {
      id: row.id, title: row.title, agent: row.agent, dept: row.dept,
      risk: row.risk, status: row.status, requestedAt: row.requested_at,
      // Present only on an approval a real Orchestrate run raised by
      // pausing for the Core-tier policy gate (migrations/0011) — lets a
      // page know to actually resume the run once approved, not just
      // flip a status. `hasRunState` is a boolean mirror of run_state's
      // presence; the full payload isn't needed client-side.
      hasRunState: !!row.run_state, resumed: !!row.resumed_at
    };
  }
  function mapAudit(row) {
    return { ts: row.ts, actor: row.actor, action: row.action, model: row.model, risk: row.risk, detail: row.detail };
  }

  function throwIfError(results) {
    for (var i = 0; i < results.length; i++) {
      if (results[i].error) throw results[i].error;
    }
    return results;
  }

  /* ---------------- reads ---------------- */
  async function loadState() {
    await ready;
    var ws = currentWorkspaceId;
    var results = await Promise.all([
      sb.from("agents").select("*").eq("workspace_id", ws).order("name"),
      sb.from("policies").select("*").eq("workspace_id", ws).order("id"),
      sb.from("approvals").select("*").eq("workspace_id", ws).order("requested_at", { ascending: false }),
      sb.from("shadow_tools").select("*").eq("workspace_id", ws).order("found_at"),
      sb.from("audit_log").select("*").eq("workspace_id", ws).order("ts", { ascending: false }).limit(300)
    ]);
    throwIfError(results);
    var agents = results[0].data, policies = results[1].data, approvals = results[2].data,
      shadowTools = results[3].data, auditLog = results[4].data;
    return {
      agents: agents,
      policies: policies.map(mapPolicy),
      approvals: approvals.map(mapApproval),
      shadowTools: shadowTools,
      auditLog: auditLog.map(mapAudit)
    };
  }

  // Mobile companion approvals view (mobile-approvals.html): a lean fetch
  // of just the approvals table — loadState() above pulls agents/
  // policies/shadow_tools/audit_log too, which a phone-scoped queue
  // doesn't need. Real for both a signed-in workspace and the read-only
  // public demo, same visibility as the full Approval Queue page —
  // deciding still goes through decideApproval()/resumeOrchestrate()
  // below, which throw for the demo via requireOwnWorkspace().
  async function getApprovalQueue() {
    await ready;
    var r = await sb.from("approvals").select("*").eq("workspace_id", currentWorkspaceId).order("requested_at", { ascending: false });
    if (r.error) throw r.error;
    return r.data.map(mapApproval);
  }

  /* ---------------- writes (all scoped to the caller's own workspace) ---------------- */
  // Admin only (RLS: migrations/0008) — .select() so a 0-row result
  // (RLS silently blocked it) can be turned into a real error below.
  async function updateAgentModel(id, model) {
    requireOwnWorkspace();
    var r = await sb.from("agents").update({ model: model, updated_at: new Date().toISOString() })
      .eq("workspace_id", currentWorkspaceId).eq("id", id).select();
    if (r.error) throw r.error;
    assertRowsChanged(r.data, "reassign an agent's model — only workspace admins can");
  }

  // Admin only (RLS: migrations/0008, same policy as reassigning a
  // model) — toggling this off for real removes the agent from the
  // very next real Orchestrate run (migrations/0016_data_driven_
  // pipeline_agents.sql, read by supabase/functions/orchestrate/
  // index.ts): the row stays in the registry, it just isn't part of
  // the pipeline until re-enabled. Has no real effect on an agent
  // that was never part of the pipeline (sequence_order is null).
  async function setAgentEnabled(id, enabled) {
    requireOwnWorkspace();
    var r = await sb.from("agents").update({ enabled: enabled, updated_at: new Date().toISOString() })
      .eq("workspace_id", currentWorkspaceId).eq("id", id).select();
    if (r.error) throw r.error;
    assertRowsChanged(r.data, "toggle an agent's real pipeline status — only workspace admins can");
  }

  // Real, random API key generation and hashing, browser-side (Web
  // Crypto — available in every modern browser over HTTPS, same API
  // functions/agent-events/index.ts uses server-side to verify it).
  // Only the hash is ever sent to the server; the raw key exists in
  // memory just long enough to be shown to the caller once.
  function generateApiKey() {
    var bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    var hex = Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    return "aiven_agt_" + hex;
  }
  async function sha256Hex(text) {
    var digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.prototype.map.call(new Uint8Array(digest), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }

  // The universal external-agent connector (migrations/0017, functions/
  // agent-events/): registers an agent this workspace already runs
  // somewhere else — any stack, any language — as a real `agents` row
  // (agent_type: 'external'). Open to any workspace member (RLS:
  // migrations/0003's "insert member only" — never tightened to admin,
  // and deliberately left that way here: adding an agent you already
  // built isn't a governance-sensitive action the way reassigning a
  // model or editing a policy is). Returns the real, one-time-visible
  // API key and the real endpoint URL to hand to whoever runs that
  // agent — neither is recoverable after this call returns; losing the
  // key means regenerating it (below), not looking it up again.
  async function registerExternalAgent(fields) {
    requireOwnWorkspace();
    var rawKey = generateApiKey();
    var hash = await sha256Hex(rawKey);
    var slug = String(fields.name || "agent").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "").slice(0, 40) || "agent";
    var id = "ext-" + slug + "-" + Math.random().toString(36).slice(2, 7);
    var r = await sb.from("agents").insert({
      workspace_id: currentWorkspaceId,
      id: id,
      name: fields.name,
      dept: fields.dept || "External",
      tier: "Core",
      model: "External",
      status: "Active",
      can: fields.note || "Reports its own real activity via the external-agent connector.",
      cannot: "Cannot be run or paused by Aiven directly — only what it reports here is real.",
      approval: "Gated only if this agent's own code checks in before acting",
      reviewed: new Date().toISOString().slice(0, 10),
      agent_type: "external",
      external_key_hash: hash
    }).select();
    if (r.error) throw r.error;
    return { agent: r.data[0], apiKey: rawKey, endpointUrl: AGENT_EVENTS_FUNCTION_URL };
  }

  // Admin only (RLS: migrations/0008's "update admin only" — same
  // policy that already covers every other agents.* UPDATE). Issues a
  // brand-new real key, replacing the old one immediately: since only
  // the hash was ever stored, there is nothing to "reveal" for a lost
  // key, only a fresh one to issue.
  async function regenerateExternalAgentKey(id) {
    requireOwnWorkspace();
    var rawKey = generateApiKey();
    var hash = await sha256Hex(rawKey);
    var r = await sb.from("agents").update({ external_key_hash: hash, updated_at: new Date().toISOString() })
      .eq("workspace_id", currentWorkspaceId).eq("id", id).eq("agent_type", "external").select();
    if (r.error) throw r.error;
    assertRowsChanged(r.data, "regenerate an external agent's key — only workspace admins can");
    return { apiKey: rawKey, endpointUrl: AGENT_EVENTS_FUNCTION_URL };
  }

  // Open to any workspace member (RLS: migrations/0003's "delete member
  // only", same reasoning as registerExternalAgent above). Scoped to
  // agent_type = 'external' here as a client-side safety rail — this
  // isn't the control for removing one of the real pipeline agents
  // (use the Enabled toggle for that instead).
  async function deleteExternalAgent(id) {
    requireOwnWorkspace();
    var r = await sb.from("agents").delete()
      .eq("workspace_id", currentWorkspaceId).eq("id", id).eq("agent_type", "external").select();
    if (r.error) throw r.error;
    assertRowsChanged(r.data, "remove an external agent");
  }

  // Admin or Compliance Owner only (RLS: migrations/0008).
  async function savePolicy(id, patch) {
    requireOwnWorkspace();
    var r = await sb.from("policies").update({
      autonomy: patch.autonomy, risk_threshold: patch.riskThreshold, escalation: patch.escalation,
      updated_at: new Date().toISOString()
    }).eq("workspace_id", currentWorkspaceId).eq("id", id).select();
    if (r.error) throw r.error;
    assertRowsChanged(r.data, "edit policy — only admins and compliance owners can");
  }

  // Open to any workspace member — approving/rejecting is a core
  // analyst workflow, not restricted by role.
  async function decideApproval(id, decision) {
    requireOwnWorkspace();
    var r = await sb.from("approvals").update({ status: decision, decided_at: new Date().toISOString() })
      .eq("workspace_id", currentWorkspaceId).eq("id", id);
    if (r.error) throw r.error;
  }

  // Admin or Compliance Owner only (RLS: migrations/0008) — an analyst
  // can still discover/log a new finding via addShadowTool below, just
  // not decide one (separation of duties).
  async function decideShadowTool(id, decision) {
    requireOwnWorkspace();
    var r = await sb.from("shadow_tools").update({ decision: decision })
      .eq("workspace_id", currentWorkspaceId).eq("id", id).select();
    if (r.error) throw r.error;
    assertRowsChanged(r.data, "govern/kill a Shadow AI finding — only admins and compliance owners can");
  }

  async function addShadowTool(tool) {
    requireOwnWorkspace();
    var r = await sb.from("shadow_tools").insert({
      workspace_id: currentWorkspaceId, id: tool.id, name: tool.name, owner: tool.owner, risk: tool.risk,
      decision: "undecided", note: tool.note
    });
    if (r.error) throw r.error;
  }

  async function addAudit(entry) {
    requireOwnWorkspace();
    var r = await sb.from("audit_log").insert({
      workspace_id: currentWorkspaceId, actor: entry.actor, action: entry.action, model: entry.model || null,
      risk: entry.risk && entry.risk !== "—" ? entry.risk : null, detail: entry.detail || null
    });
    if (r.error) throw r.error;
  }

  async function resetState() {
    // Always resets the shared public demo workspace, regardless of who's
    // signed in — a signed-in user's own workspace is untouched by this.
    var r = await sb.rpc("reseed_demo_data");
    if (r.error) throw r.error;
  }

  /* ---------------- teams / invites (current workspace) ---------------- */
  // Members' emails aren't readable via PostgREST directly (auth.users
  // isn't exposed), so this goes through the list_workspace_members RPC,
  // which checks membership server-side before returning anything.
  async function listTeam() {
    if (currentWorkspaceId === DEMO_WORKSPACE_ID) return { members: [], invites: [] };
    var membersRes = await sb.rpc("list_workspace_members", { ws: currentWorkspaceId });
    if (membersRes.error) throw membersRes.error;
    var invitesRes = await sb.from("workspace_invites").select("*")
      .eq("workspace_id", currentWorkspaceId).is("accepted_at", null)
      .order("created_at", { ascending: false });
    if (invitesRes.error) throw invitesRes.error;
    return { members: membersRes.data || [], invites: invitesRes.data || [] };
  }

  // Admin only (RLS: migrations/0008) — an INSERT whose WITH CHECK
  // fails raises a real Postgres error, so no assertRowsChanged needed
  // here the way the UPDATE/DELETE actions below need it.
  async function inviteTeammate(email, role) {
    requireOwnWorkspace();
    var r = await sb.from("workspace_invites").insert({
      workspace_id: currentWorkspaceId, email: email, role: role || "analyst", invited_by: currentUser.id
    });
    if (r.error) throw r.error;
  }

  // Admin only (RLS: migrations/0008).
  async function revokeInvite(id) {
    requireOwnWorkspace();
    var r = await sb.from("workspace_invites").delete().eq("id", id).eq("workspace_id", currentWorkspaceId).select();
    if (r.error) throw r.error;
    assertRowsChanged(r.data, "revoke an invite — only workspace admins can");
  }

  // Admin only (RLS: migrations/0008). Removing yourself ("leave
  // workspace") isn't supported — RLS blocks it outright — so this is
  // only ever called on a different member.
  async function removeMember(userId) {
    requireOwnWorkspace();
    var r = await sb.from("workspace_members").delete()
      .eq("workspace_id", currentWorkspaceId).eq("user_id", userId).select();
    if (r.error) throw r.error;
    assertRowsChanged(r.data, "remove a teammate — only workspace admins can");
  }

  // Admin only, and never on yourself (RLS: migrations/0008).
  async function changeMemberRole(userId, role) {
    requireOwnWorkspace();
    var r = await sb.from("workspace_members").update({ role: role })
      .eq("workspace_id", currentWorkspaceId).eq("user_id", userId).select();
    if (r.error) throw r.error;
    assertRowsChanged(r.data, "change a teammate's role — only workspace admins can");
  }

  /* ---------------- real model call (requires sign-in) ---------------- */
  // agentModels: optional { [agentId]: "Claude Sonnet 5" | "Claude Opus 4.8" | ... }
  // reflecting the Command Center's per-agent model dropdown — the Edge
  // Function routes each agent's real call to whichever Claude model that
  // label maps to, falling back (with a note in response.substitutions)
  // for labels with no real key configured (GPT-4o, Gemini 1.5 Pro).
  // autoRoute: when true, agentModels is ignored server-side and the
  // Edge Function picks each agent's model itself — a real, deterministic
  // cascade by risk keywords + scope size (see computeAutoRoute in
  // supabase/functions/orchestrate/index.ts), not a manual per-agent pick.
  async function orchestrate(objective, departments, sources, agentModels, autoRoute) {
    await ready;
    var session = (await sb.auth.getSession()).data.session;
    var token = session ? session.access_token : SUPABASE_ANON_KEY;
    var resp = await fetch(ORCHESTRATE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "authorization": "Bearer " + token
      },
      body: JSON.stringify({
        objective: objective, departments: departments, sources: sources,
        agentModels: agentModels || {}, autoRoute: !!autoRoute
      })
    });
    var body = await resp.json().catch(function () { return {}; });
    if (!resp.ok || body.error) {
      throw new Error(body.error || ("Orchestration request failed (" + resp.status + ")"));
    }
    // { result, model, usage, substitutions, routing } for a completed
    // run, or { paused: true, approvalId, steps, riskFlag, policy,
    // routing } if the Core-tier policy gate paused it — see
    // supabase/functions/orchestrate/index.ts.
    return body;
  }

  // Continues a run that paused for policy approval (see orchestrate()
  // above) — call once its approvals row is decided. Real per-call
  // telemetry, spend, and the eventual executive result all come from
  // this same real Anthropic call chain the original run started;
  // nothing here is re-simulated client-side. Returns the same shape as
  // orchestrate() on success, or { rejected: true, error } if the run
  // was rejected instead of approved (not thrown — a real decision, not
  // a failure).
  async function resumeOrchestrate(approvalId) {
    await ready;
    var session = (await sb.auth.getSession()).data.session;
    var token = session ? session.access_token : SUPABASE_ANON_KEY;
    var resp = await fetch(ORCHESTRATE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "authorization": "Bearer " + token
      },
      body: JSON.stringify({ resumeApprovalId: approvalId })
    });
    var body = await resp.json().catch(function () { return {}; });
    if (body.rejected) return body;
    if (!resp.ok || body.error) {
      throw new Error(body.error || ("Resume request failed (" + resp.status + ")"));
    }
    return body; // { result, model, usage, substitutions, routing, resumedApprovalId }
  }

  // Real Anthropic per-model pricing, $ / million tokens (input, output)
  // — duplicated from spend.html's own copy (and orchestrate/index.ts's
  // server-side copy that actually enforces the cap) so this real-time
  // display never needs an extra Edge Function round trip. Keep all
  // three in sync if pricing changes.
  var REAL_PRICING = {
    "claude-sonnet-5": { in: 2.00, out: 10.00 },
    "claude-opus-4-8": { in: 5.00, out: 25.00 },
    "claude-haiku-4-5": { in: 1.00, out: 5.00 }
  };
  function realCallCost(model, inputTokens, outputTokens) {
    var p = REAL_PRICING[model] || { in: 0, out: 0 };
    return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
  }

  // Reads the caller's own workspace's rolling-24h Orchestrate usage
  // against its cap, straight from the DB (RLS lets a member read their
  // own workspace row and usage log) — no Edge Function round trip.
  // Returns null for the read-only demo workspace, where Orchestrate
  // isn't available at all. Also computes the real rolling-24h dollar
  // spend against the workspace's real daily_spend_cap_usd
  // (migrations/0019) — the same second, real cap
  // orchestrate/index.ts's checkSpendCap enforces server-side; this is
  // purely a display of the identical real telemetry, not a second
  // source of truth for whether a run is actually allowed.
  async function getUsage() {
    await ready;
    if (currentWorkspaceId === DEMO_WORKSPACE_ID) return null;
    var wsRes = await sb.from("workspaces")
      .select("daily_orchestrate_limit, plan, emergency_stop, emergency_stop_at, emergency_stop_by_email, daily_spend_cap_usd, audit_retention_days")
      .eq("id", currentWorkspaceId).maybeSingle();
    if (wsRes.error) throw wsRes.error;
    var limit = (wsRes.data && wsRes.data.daily_orchestrate_limit) || 20;
    var plan = (wsRes.data && wsRes.data.plan) || "free";
    var spendCapUsd = (wsRes.data && Number(wsRes.data.daily_spend_cap_usd)) || 5;
    var since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    var countRes = await sb.from("orchestrate_usage").select("id", { count: "exact", head: true })
      .eq("workspace_id", currentWorkspaceId).gte("called_at", since);
    if (countRes.error) throw countRes.error;
    var callsRes = await sb.from("orchestrate_call_log").select("model, input_tokens, output_tokens")
      .eq("workspace_id", currentWorkspaceId).gte("called_at", since);
    if (callsRes.error) throw callsRes.error;
    var spendUsedUsd = (callsRes.data || []).reduce(function (sum, c) {
      return sum + realCallCost(c.model, c.input_tokens || 0, c.output_tokens || 0);
    }, 0);
    return {
      used: countRes.count || 0, limit: limit, plan: plan,
      spendUsedUsd: spendUsedUsd, spendCapUsd: spendCapUsd,
      emergencyStop: !!(wsRes.data && wsRes.data.emergency_stop),
      emergencyStopAt: (wsRes.data && wsRes.data.emergency_stop_at) || null,
      emergencyStopByEmail: (wsRes.data && wsRes.data.emergency_stop_by_email) || null,
      retentionDays: (wsRes.data && wsRes.data.audit_retention_days) || null
    };
  }

  // Real, measured Orchestrate spend: one row per individual agent call
  // (migrations/0010_real_spend_telemetry.sql), with the real model and
  // real token counts Anthropic actually billed — not a modeled figure.
  // `requested_model` (migrations/0012) is set only when the call asked
  // for a model with no real key configured and got silently
  // substituted — the Shadow AI Audit's real discovery scan reads that
  // same field to find genuine ungoverned-model requests, not just the
  // Spend Dashboard's real cost breakdown this was originally added for.
  // `id` (the row's own real primary key) is selected so the same scan
  // can also key a real per-call anomaly finding to one specific real
  // call, not just an aggregate.
  // Returns null for the read-only demo workspace (Orchestrate never
  // runs there, so there's nothing measured to show). Most-recent-first,
  // capped at 2000 rows — plenty for this prototype.
  async function getRealSpend() {
    await ready;
    if (currentWorkspaceId === DEMO_WORKSPACE_ID) return null;
    var r = await sb.from("orchestrate_call_log")
      .select("id, agent_id, model, requested_model, input_tokens, output_tokens, called_at")
      .eq("workspace_id", currentWorkspaceId)
      .order("called_at", { ascending: false })
      .limit(2000);
    if (r.error) throw r.error;
    return r.data || [];
  }

  // Workflow history / versioned deliverable archive: every completed
  // Orchestrate run's full deliverable, exactly as the Edge Function
  // produced it (migrations/0013_workflow_history.sql) — not just the
  // one-line audit_log entry a run also leaves. Returns null for the
  // read-only demo workspace (Orchestrate never runs there). Most-
  // recent-first, capped at 200 — a real per-workspace archive, but this
  // prototype doesn't paginate past that yet.
  async function getRunHistory() {
    await ready;
    if (currentWorkspaceId === DEMO_WORKSPACE_ID) return null;
    var r = await sb.from("orchestrate_runs")
      .select("id, objective, departments, sources, auto_route, routing, steps, executive_summary, findings, recommendations, risk_flags, model, input_tokens, output_tokens, substitutions, was_paused, approval_id, created_at")
      .eq("workspace_id", currentWorkspaceId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (r.error) throw r.error;
    return r.data || [];
  }

  // Natural-language audit trail Q&A — a real Claude call grounded
  // strictly in this workspace's real audit_log rows (see
  // supabase/functions/audit-qa/index.ts and
  // migrations/0014_audit_qa.sql). Requires a signed-in session, same as
  // orchestrate(); rate-limited per workspace server-side, separately
  // from the Orchestrate cap.
  async function askAuditTrail(question) {
    await ready;
    var session = (await sb.auth.getSession()).data.session;
    var token = session ? session.access_token : SUPABASE_ANON_KEY;
    var resp = await fetch(AUDIT_QA_FUNCTION_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "authorization": "Bearer " + token
      },
      body: JSON.stringify({ question: question })
    });
    var body = await resp.json().catch(function () { return {}; });
    if (!resp.ok || body.error) {
      throw new Error(body.error || ("Question failed (" + resp.status + ")"));
    }
    return body; // { answer, model, usage, logRowsConsidered }
  }

  // Real, persisted history of every question asked and answered for
  // this workspace (migrations/0014) — so, like workflow history, a
  // past answer is still there after you navigate away. Returns null
  // for the read-only demo workspace.
  async function getAuditQaHistory() {
    await ready;
    if (currentWorkspaceId === DEMO_WORKSPACE_ID) return null;
    var r = await sb.from("audit_qa_log")
      .select("id, question, answer, log_rows_considered, model, input_tokens, output_tokens, created_at")
      .eq("workspace_id", currentWorkspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (r.error) throw r.error;
    return r.data || [];
  }

  // Saved objective templates ("run this same analysis monthly") —
  // real, client-writable rows (migrations/0015_objective_templates.sql),
  // not derived telemetry, so these go through RLS with the caller's own
  // token like policies/approvals/shadow_tools, not a service-role-only
  // Edge Function. Open to any workspace member, same as orchestrating
  // itself. Returns null for the read-only demo workspace.
  async function listTemplates() {
    await ready;
    if (currentWorkspaceId === DEMO_WORKSPACE_ID) return null;
    var r = await sb.from("objective_templates")
      .select("id, name, objective, departments, sources, auto_route, agent_models, created_at, last_used_at")
      .eq("workspace_id", currentWorkspaceId)
      .order("created_at", { ascending: false });
    if (r.error) throw r.error;
    return r.data || [];
  }

  // opts: { name, objective, departments, sources, autoRoute, agentModels }
  // Returns the newly-inserted row (with its real id) so the caller can
  // add it to a local list without a second round trip.
  async function saveTemplate(opts) {
    requireOwnWorkspace();
    var r = await sb.from("objective_templates").insert({
      workspace_id: currentWorkspaceId,
      created_by: currentUser ? currentUser.id : null,
      name: opts.name,
      objective: opts.objective,
      departments: opts.departments || [],
      sources: opts.sources || [],
      auto_route: !!opts.autoRoute,
      agent_models: opts.agentModels || {}
    }).select().single();
    if (r.error) throw r.error;
    return r.data;
  }

  async function deleteTemplate(id) {
    requireOwnWorkspace();
    var r = await sb.from("objective_templates").delete()
      .eq("workspace_id", currentWorkspaceId).eq("id", id).select();
    if (r.error) throw r.error;
    assertRowsChanged(r.data, "delete a template — only workspace members can");
  }

  // Best-effort "this template was just run" timestamp — never blocks or
  // fails the actual Orchestrate call it's attached to.
  async function touchTemplateUsed(id) {
    try {
      await sb.from("objective_templates").update({ last_used_at: new Date().toISOString() })
        .eq("workspace_id", currentWorkspaceId).eq("id", id);
    } catch (e) {
      console.error("Failed to update template last_used_at", e);
    }
  }

  // Admin only (RLS: the workspaces table has no client UPDATE policy at
  // all — this security-definer RPC, migrations/0009, is the sole write
  // path). Changes the enforced Orchestrate cap to the picked plan's
  // fixed limit. No real billing/payment processing — this changes the
  // real, enforced cap immediately, but nothing is actually charged.
  async function setPlan(plan) {
    requireOwnWorkspace();
    var r = await sb.rpc("set_workspace_plan", { ws: currentWorkspaceId, new_plan: plan });
    if (r.error) throw r.error;
  }

  // Admin-only RPC (migrations/0018) — the bigger, blunter sibling of
  // the per-agent Enabled toggle in Agent Registry. Freezes/unfreezes
  // every real action this workspace's server side actually controls:
  // a new Orchestrate run, resuming a paused one (orchestrate/index.ts),
  // and an external agent's own check_approval poll (agent-events/
  // index.ts) — real for real, but still can't reach into an external
  // agent's own code (see USER_GUIDE.md's honest limit on that).
  async function setEmergencyStop(active) {
    requireOwnWorkspace();
    var r = await sb.rpc("set_emergency_stop", { ws: currentWorkspaceId, active: !!active });
    if (r.error) throw r.error;
  }

  // Admin-only RPC (migrations/0021) — same "workspaces has no
  // client-facing UPDATE policy, this RPC is the sole write path"
  // pattern as setEmergencyStop/setPlan above. `days` null means no
  // automatic deletion (the default); otherwise real audit_log and
  // orchestrate_runs rows older than that many days get deleted for
  // real, both by a real daily pg_cron job and by runDataRetentionNow
  // below.
  async function setDataRetention(days) {
    requireOwnWorkspace();
    var r = await sb.rpc("set_data_retention", { ws: currentWorkspaceId, days: days });
    if (r.error) throw r.error;
  }

  // Admin-only RPC (migrations/0021) — real, immediate deletion of this
  // workspace's own expired rows, using the identical delete path the
  // scheduled daily job uses, so a demo (or an actual admin) gets real
  // proof retention is enforced instead of a leap of faith about
  // whether the background cron job is actually configured or running.
  // Requires a retention window to already be set — throws a real error
  // otherwise. Returns { auditDeleted, runsDeleted } for a real toast.
  async function runDataRetentionNow() {
    requireOwnWorkspace();
    var r = await sb.rpc("run_data_retention_now", { ws: currentWorkspaceId });
    if (r.error) throw r.error;
    var row = Array.isArray(r.data) ? r.data[0] : r.data;
    return { auditDeleted: (row && row.audit_deleted) || 0, runsDeleted: (row && row.runs_deleted) || 0 };
  }

  // Workspace-configured webhook notifications (migrations/0020) — real,
  // admin-only config for the one incoming-webhook URL orchestrate/
  // index.ts posts a real HTTP request to the moment a run actually
  // pauses for approval. Direct, client-writable RLS (like
  // objective_templates), not a security-definer RPC — this is a
  // dedicated table an admin owns outright, not a shared column on
  // `workspaces` everyone reads. Returns null for the read-only demo
  // workspace, and null if nothing is configured yet.
  async function getWebhookConfig() {
    await ready;
    if (currentWorkspaceId === DEMO_WORKSPACE_ID) return null;
    var r = await sb.from("webhook_endpoints")
      .select("url, enabled, created_at")
      .eq("workspace_id", currentWorkspaceId).maybeSingle();
    if (r.error) throw r.error;
    return r.data || null;
  }

  // Admin-only upsert (RLS: insert/update policies both gated by
  // private.is_workspace_admin) — one row per workspace (primary key),
  // so saving a new URL replaces the old config rather than
  // accumulating rows.
  async function setWebhookConfig(url, enabled) {
    requireOwnWorkspace();
    var r = await sb.from("webhook_endpoints").upsert({
      workspace_id: currentWorkspaceId,
      url: url,
      enabled: !!enabled,
      created_by: currentUser ? currentUser.id : null,
      updated_at: new Date().toISOString()
    }, { onConflict: "workspace_id" }).select();
    if (r.error) throw r.error;
    assertRowsChanged(r.data, "configure a webhook — only workspace admins can");
  }

  // Real delivery log (migrations/0020) — every actual outbound POST
  // attempt orchestrate/index.ts made, win or lose, so "is this thing
  // even working" has a real answer instead of a leap of faith.
  // Most-recent-first, capped at 5 — just enough for a status readout.
  async function getWebhookDeliveries() {
    await ready;
    if (currentWorkspaceId === DEMO_WORKSPACE_ID) return null;
    var r = await sb.from("webhook_deliveries")
      .select("event_type, response_status, success, error_detail, delivered_at")
      .eq("workspace_id", currentWorkspaceId)
      .order("delivered_at", { ascending: false })
      .limit(5);
    if (r.error) throw r.error;
    return r.data || [];
  }

  /* ---------------- auth actions ---------------- */
  function currentRedirectUrl() {
    return global.location.origin + global.location.pathname;
  }
  async function signInWithEmail(email) {
    var r = await sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: currentRedirectUrl() } });
    if (r.error) throw r.error;
  }
  async function signOut() {
    var r = await sb.auth.signOut();
    if (r.error) throw r.error;
  }
  function getUser() { return currentUser; }
  function isDemo() { return currentWorkspaceId === DEMO_WORKSPACE_ID; }
  function getWorkspaces() { return currentWorkspaces; }
  function onAuthChange(fn) {
    authListeners.push(fn);
    ready.then(function () { fn(currentUser, currentWorkspaceId); });
  }

  /* ---------------- team modal (built on demand, not per-page markup) ---------------- */
  function currentWorkspaceName() {
    var ws = currentWorkspaces.find(function (w) { return w.id === currentWorkspaceId; });
    return ws ? ws.name : "your workspace";
  }
  function closeTeamModal() {
    var el = document.getElementById("aiven-team-modal-overlay");
    if (el) el.remove();
  }
  var ROLE_OPTIONS = ["admin", "compliance_owner", "analyst"];
  function roleSelectHtml(idAttr, valueAttr, selected) {
    return "<select class='control team-role-select' " + idAttr + " " + valueAttr + ">" +
      ROLE_OPTIONS.map(function (r) { return "<option value='" + r + "'" + (r === selected ? " selected" : "") + ">" + roleLabel(r) + "</option>"; }).join("") +
      "</select>";
  }

  // The bigger, blunter sibling of Agent Registry's per-agent Enabled
  // toggle (migrations/0018) — shown first, above Plan, since it's the
  // one control here with the widest real blast radius. Visible to
  // every member (so nobody wonders why Orchestrate is suddenly
  // frozen); only an admin gets the button that flips it.
  function renderEmergencyStopSection(usage, amAdmin) {
    if (!usage) return "";
    var active = !!usage.emergencyStop;
    var status = active
      ? "<p class='hint critical-hint'>⛔ <strong>Active</strong> — every new Orchestrate run, every paused-run resume, and every external agent's approval check is frozen" +
        (usage.emergencyStopByEmail ? " (activated by " + usage.emergencyStopByEmail + (usage.emergencyStopAt ? ", " + timeAgo(usage.emergencyStopAt) : "") + ")" : "") + "."
      : "<p class='hint'>Not active — Orchestrate and external agent gate checks run normally.</p>";
    var button = amAdmin
      ? "<div class='plan-actions'><button class='btn small ghost" + (active ? "" : " reject") + "' id='aiven-emergency-stop-btn' type='button'>" +
        (active ? "Lift emergency stop" : "Activate emergency stop") + "</button></div>"
      : "";
    return "<div class='team-section'><h4>Emergency Stop</h4>" + status + button +
      "<p class='hint'>Real, not cosmetic — but it can only freeze what Aiven itself runs. An external agent's own code still decides whether to check in first; see the Agent Registry guide.</p>" +
      "</div>";
  }

  // Fixed plan -> Orchestrate-cap table, mirroring the one enforced
  // server-side in set_workspace_plan (migrations/0009) — shown here
  // purely for display/labeling, not as a second source of truth (the
  // RPC itself decides the real number).
  var PLAN_INFO = {
    free: { label: "Free", limit: 20 },
    pro: { label: "Pro", limit: 100 },
    enterprise: { label: "Enterprise", limit: 500 }
  };
  var PLAN_ORDER = ["free", "pro", "enterprise"];
  function renderPlanSection(usage, amAdmin) {
    if (!usage) return "";
    var info = PLAN_INFO[usage.plan] || PLAN_INFO.free;
    var buttons = amAdmin
      ? PLAN_ORDER.filter(function (key) { return key !== usage.plan; }).map(function (key) {
          var verb = PLAN_INFO[key].limit > usage.limit ? "Upgrade to " : "Downgrade to ";
          return "<button class='btn small ghost' data-set-plan='" + key + "' type='button'>" + verb + PLAN_INFO[key].label + "</button>";
        }).join("")
      : "";
    var spendPct = usage.spendCapUsd > 0 ? Math.min(100, Math.round((usage.spendUsedUsd / usage.spendCapUsd) * 100)) : 0;
    return "<div class='team-section'><h4>Plan</h4>" +
      "<div class='plan-row'><span class='plan-badge'>" + info.label + "</span>" +
      "<span class='plan-usage'>" + usage.used + " / " + usage.limit + " Orchestrate runs used today</span></div>" +
      "<div class='plan-row'><span class='plan-usage'>$" + usage.spendUsedUsd.toFixed(2) + " / $" + usage.spendCapUsd.toFixed(2) +
      " spent today (real, " + spendPct + "%)</span></div>" +
      (buttons ? "<div class='plan-actions'>" + buttons + "</div>" : "") +
      "<p class='hint'>No real billing here — changing plan immediately changes the real, enforced daily run and dollar caps; nothing is actually charged. The dollar figure is real, measured spend at real Anthropic rates, not modeled.</p>" +
      "</div>";
  }

  // A plain incoming-webhook URL an admin pastes in — no OAuth app, no
  // new credential Aiven itself has to hold. Visible to every member as
  // a read-only status line; only an admin gets the form to set/change
  // it. Deliberately no "send test webhook" button in this pass — a
  // client-side test POST would run into CORS restrictions the pasted
  // endpoint likely doesn't handle, unlike the server-side Deno fetch
  // orchestrate/index.ts makes for a real delivery, which has none —
  // a natural fast-follow, not a silent omission.
  function renderWebhookSection(webhookConfig, deliveries, amAdmin) {
    var configured = !!(webhookConfig && webhookConfig.url);
    var statusHtml = !configured
      ? "<p class='hint'>Not configured — no run-paused notifications are sent.</p>"
      : "<p class='hint'>" + (webhookConfig.enabled ? "Active" : "Saved, but disabled") +
        " — <code>" + webhookConfig.url.replace(/</g, "&lt;") + "</code></p>";
    var lastDelivery = deliveries && deliveries.length ? deliveries[0] : null;
    var deliveryHtml = lastDelivery
      ? "<p class='hint'>Last delivery: " + (lastDelivery.success
          ? "✅ succeeded"
          : "⚠️ failed" + (lastDelivery.response_status ? " (HTTP " + lastDelivery.response_status + ")" : "")) +
        ", " + timeAgo(lastDelivery.delivered_at) + "</p>"
      : (configured ? "<p class='hint'>No deliveries yet — nothing has paused for approval since this was configured.</p>" : "");
    var formHtml = amAdmin
      ? "<div class='team-invite-form'>" +
        "<input class='control' id='aiven-webhook-url' type='url' placeholder='https://example.com/hooks/aiven' value='" +
        (configured ? webhookConfig.url.replace(/&/g, "&amp;").replace(/'/g, "&#39;") : "") + "'>" +
        "<button class='btn small' id='aiven-webhook-save-btn' type='button'>Save</button>" +
        (configured ? "<button class='btn small ghost' id='aiven-webhook-toggle-btn' type='button'>" + (webhookConfig.enabled ? "Disable" : "Enable") + "</button>" : "") +
        "</div>"
      : "";
    return "<div class='team-section'><h4>Webhook Notifications</h4>" + statusHtml + deliveryHtml + formHtml +
      "<p class='hint'>Fires a real HTTP POST the moment a run pauses for approval — the one event nobody is otherwise notified of today. No other event types yet.</p>" +
      "</div>";
  }

  // A real, workspace-configurable auto-delete window (migrations/0021)
  // for audit_log and orchestrate_runs — a common real enterprise
  // procurement ask (GDPR data-minimization), not yet extended to any
  // other telemetry table. Unset (the default) means no automatic
  // deletion, matching every workspace's real behavior before this
  // existed. Enforced two real ways: a daily pg_cron job, and (for an
  // admin who wants real, immediate proof instead of trusting a
  // background job) the "Run retention now" button below.
  var RETENTION_OPTIONS = [
    { value: "", label: "No automatic deletion" },
    { value: "30", label: "30 days" },
    { value: "90", label: "90 days" },
    { value: "180", label: "180 days" },
    { value: "365", label: "365 days" }
  ];
  function renderRetentionSection(usage, amAdmin) {
    if (!usage) return "";
    var days = usage.retentionDays;
    var statusHtml = days
      ? "<p class='hint'>Active — Audit Trail and Workflow History rows older than " + days + " days are deleted automatically, once a day.</p>"
      : "<p class='hint'>Not set — no automatic deletion. A common GDPR/data-minimization ask; set a window below to enable it.</p>";
    var selectedValue = days ? String(days) : "";
    var formHtml = amAdmin
      ? "<div class='team-invite-form'>" +
        "<select class='control' id='aiven-retention-select'>" +
        RETENTION_OPTIONS.map(function (o) { return "<option value='" + o.value + "'" + (o.value === selectedValue ? " selected" : "") + ">" + o.label + "</option>"; }).join("") +
        "</select>" +
        "<button class='btn small' id='aiven-retention-save-btn' type='button'>Save</button>" +
        (days ? "<button class='btn small ghost' id='aiven-retention-run-btn' type='button'>Run retention now</button>" : "") +
        "</div>"
      : "";
    return "<div class='team-section'><h4>Data Retention</h4>" + statusHtml + formHtml +
      "<p class='hint'>Deletes real rows for good, not just hides them — scoped to Audit Trail and Workflow History; not yet extended to spend telemetry or the audit trail Q&A log.</p>" +
      "</div>";
  }

  function renderTeamBody(body, team, myRole, usage, webhookConfig, deliveries) {
    var amAdmin = myRole === "admin";
    var membersHtml = team.members.map(function (m) {
      var mine = currentUser && m.user_id === currentUser.id;
      var roleDisplay = amAdmin && !mine
        ? roleSelectHtml("data-role-member='" + m.user_id + "'", "", m.role)
        : "<span class='team-role'>" + roleLabel(m.role) + "</span>";
      return "<div class='team-row'><div><span class='team-email'>" + m.email + (mine ? " (you)" : "") + "</span>" + roleDisplay + "</div>" +
        (amAdmin && !mine ? "<button class='btn small ghost' data-remove-member='" + m.user_id + "' type='button'>Remove</button>" : "") +
        "</div>";
    }).join("") || "<p class='muted'>No members yet.</p>";

    var invitesHtml = team.invites.map(function (inv) {
      return "<div class='team-row'><div><span class='team-email'>" + inv.email + "</span>" +
        "<span class='team-role'>" + roleLabel(inv.role) + " · pending</span></div>" +
        (amAdmin ? "<button class='btn small ghost' data-revoke-invite='" + inv.id + "' type='button'>Revoke</button>" : "") +
        "</div>";
    }).join("") || "<p class='muted'>No pending invites.</p>";

    var inviteFormHtml = amAdmin
      ? "<div class='team-section'><h4>Invite a teammate</h4>" +
        "<div class='team-invite-form'>" +
        "<input class='control' id='aiven-invite-email' type='email' placeholder='teammate@company.com' autocomplete='email'>" +
        roleSelectHtml("id='aiven-invite-role'", "", "analyst") +
        "<button class='btn small' id='aiven-invite-btn' type='button'>Send invite</button>" +
        "</div>" +
        "<p class='hint'>They'll join this workspace automatically the next time they sign in with that email — no separate accept step.</p>" +
        "</div>"
      : "<p class='muted'>Only workspace admins can invite, remove, or change roles. Ask an admin (" + roleLabel("admin") + ") on this list.</p>";

    body.innerHTML =
      renderEmergencyStopSection(usage, amAdmin) +
      renderPlanSection(usage, amAdmin) +
      (usage ? renderWebhookSection(webhookConfig, deliveries, amAdmin) : "") +
      renderRetentionSection(usage, amAdmin) +
      "<div class='team-section'><h4>Members</h4>" + membersHtml + "</div>" +
      "<div class='team-section'><h4>Pending invites</h4>" + invitesHtml + "</div>" +
      inviteFormHtml;

    async function refresh() {
      var results = await Promise.all([listTeam(), getUsage(), getWebhookConfig(), getWebhookDeliveries()]);
      renderTeamBody(body, results[0], myRole, results[1], results[2], results[3]);
    }

    var stopBtn = body.querySelector("#aiven-emergency-stop-btn");
    if (stopBtn) {
      stopBtn.addEventListener("click", async function () {
        var activating = !usage.emergencyStop;
        if (activating && !global.confirm("Freeze every new Orchestrate run, every paused-run resume, and every external agent's approval check in this workspace, right now? Lift it the same way once the incident is resolved.")) return;
        stopBtn.disabled = true;
        try {
          await setEmergencyStop(activating);
          toast(activating ? "Emergency stop activated — Orchestrate is frozen." : "Emergency stop lifted — Orchestrate is back to normal.");
          await refresh();
        } catch (e) {
          toast("Failed to change the emergency stop: " + e.message);
          stopBtn.disabled = false;
        }
      });
    }

    body.querySelectorAll("[data-set-plan]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var plan = btn.getAttribute("data-set-plan");
        btn.disabled = true;
        try { await setPlan(plan); toast("Plan changed to " + (PLAN_INFO[plan] ? PLAN_INFO[plan].label : plan) + "."); await refresh(); }
        catch (e) { toast("Failed to change plan: " + e.message); btn.disabled = false; }
      });
    });

    var webhookSaveBtn = body.querySelector("#aiven-webhook-save-btn");
    if (webhookSaveBtn) {
      webhookSaveBtn.addEventListener("click", async function () {
        var input = body.querySelector("#aiven-webhook-url");
        var url = input.value.trim();
        if (!url) { toast("Enter a webhook URL first."); return; }
        webhookSaveBtn.disabled = true;
        try {
          await setWebhookConfig(url, true);
          toast("Webhook saved — future paused runs will POST here.");
          await refresh();
        } catch (e) {
          toast("Failed to save webhook: " + e.message);
          webhookSaveBtn.disabled = false;
        }
      });
    }
    var webhookToggleBtn = body.querySelector("#aiven-webhook-toggle-btn");
    if (webhookToggleBtn) {
      webhookToggleBtn.addEventListener("click", async function () {
        webhookToggleBtn.disabled = true;
        try {
          await setWebhookConfig(webhookConfig.url, !webhookConfig.enabled);
          toast(webhookConfig.enabled ? "Webhook disabled." : "Webhook enabled.");
          await refresh();
        } catch (e) {
          toast("Failed to change webhook: " + e.message);
          webhookToggleBtn.disabled = false;
        }
      });
    }

    var retentionSaveBtn = body.querySelector("#aiven-retention-save-btn");
    if (retentionSaveBtn) {
      retentionSaveBtn.addEventListener("click", async function () {
        var select = body.querySelector("#aiven-retention-select");
        var raw = select.value;
        var days = raw ? parseInt(raw, 10) : null;
        retentionSaveBtn.disabled = true;
        try {
          await setDataRetention(days);
          toast(days ? "Retention window set to " + days + " days." : "Automatic deletion disabled.");
          await refresh();
        } catch (e) {
          toast("Failed to save retention window: " + e.message);
          retentionSaveBtn.disabled = false;
        }
      });
    }
    var retentionRunBtn = body.querySelector("#aiven-retention-run-btn");
    if (retentionRunBtn) {
      retentionRunBtn.addEventListener("click", async function () {
        if (!global.confirm("Delete every real Audit Trail and Workflow History row older than " + usage.retentionDays + " days, right now? This can't be undone.")) return;
        retentionRunBtn.disabled = true;
        try {
          var result = await runDataRetentionNow();
          toast("Deleted " + result.auditDeleted + " audit log row(s) and " + result.runsDeleted + " archived run(s).");
          await refresh();
        } catch (e) {
          toast("Failed to run retention: " + e.message);
          retentionRunBtn.disabled = false;
        }
      });
    }

    body.querySelectorAll("[data-remove-member]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        if (!global.confirm("Remove this teammate from the workspace?")) return;
        btn.disabled = true;
        try { await removeMember(btn.getAttribute("data-remove-member")); toast("Removed from the workspace."); await refresh(); }
        catch (e) { toast("Failed to remove: " + e.message); btn.disabled = false; }
      });
    });
    body.querySelectorAll("[data-revoke-invite]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        btn.disabled = true;
        try { await revokeInvite(btn.getAttribute("data-revoke-invite")); toast("Invite revoked."); await refresh(); }
        catch (e) { toast("Failed to revoke: " + e.message); btn.disabled = false; }
      });
    });
    body.querySelectorAll("[data-role-member]").forEach(function (sel) {
      var original = sel.value;
      sel.addEventListener("change", async function () {
        var userId = sel.getAttribute("data-role-member");
        var newRole = sel.value;
        sel.disabled = true;
        try { await changeMemberRole(userId, newRole); toast("Role updated to " + roleLabel(newRole) + "."); await refresh(); }
        catch (e) { toast("Failed to change role: " + e.message); sel.value = original; sel.disabled = false; }
      });
    });

    if (amAdmin) {
      var inviteBtn = body.querySelector("#aiven-invite-btn");
      var inviteInput = body.querySelector("#aiven-invite-email");
      var inviteRole = body.querySelector("#aiven-invite-role");
      var submitInvite = async function () {
        var email = inviteInput.value.trim();
        if (!email) { toast("Enter an email address first."); return; }
        inviteBtn.disabled = true;
        try {
          await inviteTeammate(email, inviteRole.value);
          toast("Invited " + email + " as " + roleLabel(inviteRole.value) + " — they'll join automatically on their next sign-in.");
          inviteInput.value = "";
          await refresh();
        } catch (e) {
          toast("Invite failed: " + e.message);
        } finally {
          inviteBtn.disabled = false;
        }
      };
      inviteBtn.addEventListener("click", submitInvite);
      inviteInput.addEventListener("keydown", function (e) { if (e.key === "Enter") submitInvite(); });
    }
  }
  async function openTeamModal() {
    closeTeamModal();
    var overlay = document.createElement("div");
    overlay.className = "aiven-modal-overlay";
    overlay.id = "aiven-team-modal-overlay";
    overlay.innerHTML =
      "<div class='aiven-modal'>" +
      "<div class='aiven-modal-head'><h3>" + currentWorkspaceName() + "</h3>" +
      "<button class='aiven-modal-close' type='button' aria-label='Close'>&times;</button></div>" +
      "<div class='aiven-modal-body' id='aiven-team-body'><p class='muted'>Loading…</p></div>" +
      "</div>";
    document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeTeamModal(); });
    overlay.querySelector(".aiven-modal-close").addEventListener("click", closeTeamModal);
    var body = overlay.querySelector("#aiven-team-body");
    try {
      var results = await Promise.all([listTeam(), getUsage(), getWebhookConfig(), getWebhookDeliveries()]);
      renderTeamBody(body, results[0], getRole(), results[1], results[2], results[3]);
    } catch (e) {
      body.innerHTML = "<p class='muted'>Failed to load team: " + e.message + "</p>";
    }
  }

  /* ---------------- auth widget (shared markup injected into every page) ---------------- */
  function renderAuthWidget(container) {
    if (!container) return;
    if (currentUser) {
      var switcherHtml = currentWorkspaces.length > 1
        ? "<select class='control auth-ws-select' id='auth-ws-select' title='Switch workspace'>" +
          currentWorkspaces.map(function (w) {
            return "<option value='" + w.id + "'" + (w.id === currentWorkspaceId ? " selected" : "") + ">" + w.name + "</option>";
          }).join("") + "</select>"
        : "";
      container.innerHTML =
        switcherHtml +
        "<span class='auth-email' title='Signed in'>" + currentUser.email + "</span>" +
        "<button class='btn small' id='auth-team-btn' type='button'>Workspace</button>" +
        "<button class='btn small' id='auth-signout-btn' type='button'>Sign out</button>";
      var wsSelect = container.querySelector("#auth-ws-select");
      if (wsSelect) wsSelect.addEventListener("change", function () { switchWorkspace(wsSelect.value); });
      container.querySelector("#auth-team-btn").addEventListener("click", openTeamModal);
      var out = container.querySelector("#auth-signout-btn");
      out.addEventListener("click", async function () {
        out.disabled = true;
        try { await signOut(); toast("Signed out — back to the read-only demo."); global.location.reload(); }
        catch (e) { toast("Sign out failed: " + e.message); out.disabled = false; }
      });
    } else {
      container.innerHTML =
        "<span class='auth-badge'>Demo (read-only)</span>" +
        "<input class='control auth-email-input' id='auth-email-input' type='email' placeholder='you@company.com' autocomplete='email'>" +
        "<button class='btn small' id='auth-signin-btn' type='button'>Sign in</button>";
      var btn = container.querySelector("#auth-signin-btn");
      var input = container.querySelector("#auth-email-input");
      var submit = async function () {
        var email = input.value.trim();
        if (!email) { toast("Enter an email address first."); return; }
        btn.disabled = true;
        try {
          await signInWithEmail(email);
          toast("Magic link sent to " + email + " — check your inbox.");
          input.value = "";
        } catch (e) {
          toast("Sign-in failed: " + e.message);
        } finally {
          btn.disabled = false;
        }
      };
      btn.addEventListener("click", submit);
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
    }
  }
  function mountAuthWidget(containerOrId) {
    var container = typeof containerOrId === "string" ? document.getElementById(containerOrId) : containerOrId;
    if (!container) return;
    onAuthChange(function () { renderAuthWidget(container); });
  }

  /* ---------------- time formatting ---------------- */
  function timeAgo(iso) {
    if (!iso) return "—";
    var diffMs = Date.now() - new Date(iso).getTime();
    var mins = Math.max(0, Math.round(diffMs / 60000));
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    var days = Math.round(hrs / 24);
    return days + "d ago";
  }
  function timeClock(iso) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  /* ---------------- toast ---------------- */
  function toast(msg) {
    var wrap = document.getElementById("toast-wrap");
    if (!wrap) return;
    var el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.opacity = "0";
      el.style.transition = "opacity .3s";
      setTimeout(function () { el.remove(); }, 300);
    }, 3600);
  }

  /* ---------------- shared chrome: theme, clock, nav highlight, reset, auth widget ---------------- */
  function initChrome() {
    var root = document.documentElement;
    var themeBtn = document.getElementById("theme-toggle");
    if (themeBtn) {
      themeBtn.addEventListener("click", function () {
        var cur = root.getAttribute("data-theme");
        var mql = global.matchMedia("(prefers-color-scheme: dark)").matches;
        var effectiveDark = cur ? cur === "dark" : mql;
        root.setAttribute("data-theme", effectiveDark ? "light" : "dark");
      });
    }

    var clockEl = document.getElementById("clock");
    if (clockEl) {
      var tick = function () {
        var d = new Date();
        clockEl.textContent = d.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" }) + " · " +
          d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      };
      tick();
      setInterval(tick, 1000);
    }

    var page = document.body.getAttribute("data-page");
    if (page) {
      document.querySelectorAll(".subnav a[data-page]").forEach(function (a) {
        if (a.getAttribute("data-page") === page) a.classList.add("active");
      });
    }

    var resetBtn = document.getElementById("reset-demo");
    if (resetBtn) {
      resetBtn.addEventListener("click", async function () {
        if (!global.confirm("Reset the shared PUBLIC DEMO workspace back to its seeded state? (Your own workspace, if you're signed in, is untouched.) This clears every approval, policy edit, and audit entry anyone has added to the demo.")) return;
        resetBtn.disabled = true;
        try {
          await resetState();
          global.location.reload();
        } catch (e) {
          toast("Reset failed: " + e.message);
          resetBtn.disabled = false;
        }
      });
    }

    mountAuthWidget("auth-widget");
  }

  global.Aiven = {
    ready: ready,
    loadState: loadState,
    getApprovalQueue: getApprovalQueue,
    updateAgentModel: updateAgentModel,
    setAgentEnabled: setAgentEnabled,
    registerExternalAgent: registerExternalAgent,
    regenerateExternalAgentKey: regenerateExternalAgentKey,
    deleteExternalAgent: deleteExternalAgent,
    savePolicy: savePolicy,
    decideApproval: decideApproval,
    decideShadowTool: decideShadowTool,
    addShadowTool: addShadowTool,
    addAudit: addAudit,
    resetState: resetState,
    orchestrate: orchestrate,
    resumeOrchestrate: resumeOrchestrate,
    getUsage: getUsage,
    getRealSpend: getRealSpend,
    getRunHistory: getRunHistory,
    askAuditTrail: askAuditTrail,
    getAuditQaHistory: getAuditQaHistory,
    listTemplates: listTemplates,
    saveTemplate: saveTemplate,
    deleteTemplate: deleteTemplate,
    touchTemplateUsed: touchTemplateUsed,
    setPlan: setPlan,
    setEmergencyStop: setEmergencyStop,
    setDataRetention: setDataRetention,
    runDataRetentionNow: runDataRetentionNow,
    getWebhookConfig: getWebhookConfig,
    setWebhookConfig: setWebhookConfig,
    getWebhookDeliveries: getWebhookDeliveries,
    timeAgo: timeAgo,
    timeClock: timeClock,
    toast: toast,
    initChrome: initChrome,
    auth: {
      signInWithEmail: signInWithEmail,
      signOut: signOut,
      getUser: getUser,
      isDemo: isDemo,
      onChange: onAuthChange,
      getWorkspaces: getWorkspaces,
      switchWorkspace: switchWorkspace,
      getRole: getRole,
      isAdmin: isAdmin,
      isComplianceOwner: isComplianceOwner
    },
    team: {
      list: listTeam,
      invite: inviteTeammate,
      revokeInvite: revokeInvite,
      removeMember: removeMember,
      changeMemberRole: changeMemberRole
    }
  };
})(window);
