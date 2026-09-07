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
      risk: row.risk, status: row.status, requestedAt: row.requested_at
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

  /* ---------------- writes (all scoped to the caller's own workspace) ---------------- */
  async function updateAgentModel(id, model) {
    requireOwnWorkspace();
    var r = await sb.from("agents").update({ model: model, updated_at: new Date().toISOString() })
      .eq("workspace_id", currentWorkspaceId).eq("id", id);
    if (r.error) throw r.error;
  }

  async function savePolicy(id, patch) {
    requireOwnWorkspace();
    var r = await sb.from("policies").update({
      autonomy: patch.autonomy, risk_threshold: patch.riskThreshold, escalation: patch.escalation,
      updated_at: new Date().toISOString()
    }).eq("workspace_id", currentWorkspaceId).eq("id", id);
    if (r.error) throw r.error;
  }

  async function decideApproval(id, decision) {
    requireOwnWorkspace();
    var r = await sb.from("approvals").update({ status: decision, decided_at: new Date().toISOString() })
      .eq("workspace_id", currentWorkspaceId).eq("id", id);
    if (r.error) throw r.error;
  }

  async function decideShadowTool(id, decision) {
    requireOwnWorkspace();
    var r = await sb.from("shadow_tools").update({ decision: decision })
      .eq("workspace_id", currentWorkspaceId).eq("id", id);
    if (r.error) throw r.error;
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

  async function inviteTeammate(email) {
    requireOwnWorkspace();
    var r = await sb.from("workspace_invites").insert({
      workspace_id: currentWorkspaceId, email: email, invited_by: currentUser.id
    });
    if (r.error) throw r.error;
  }

  async function revokeInvite(id) {
    requireOwnWorkspace();
    var r = await sb.from("workspace_invites").delete().eq("id", id).eq("workspace_id", currentWorkspaceId);
    if (r.error) throw r.error;
  }

  // Removing yourself ("leave workspace") isn't supported — RLS blocks
  // it outright (see migrations/0007) — so this is only ever called on
  // a different member.
  async function removeMember(userId) {
    requireOwnWorkspace();
    var r = await sb.from("workspace_members").delete().eq("workspace_id", currentWorkspaceId).eq("user_id", userId);
    if (r.error) throw r.error;
  }

  /* ---------------- real model call (requires sign-in) ---------------- */
  // agentModels: optional { [agentId]: "Claude Sonnet 5" | "Claude Opus 4.8" | ... }
  // reflecting the Command Center's per-agent model dropdown — the Edge
  // Function routes each agent's real call to whichever Claude model that
  // label maps to, falling back (with a note in response.substitutions)
  // for labels with no real key configured (GPT-4o, Gemini 1.5 Pro).
  async function orchestrate(objective, departments, sources, agentModels) {
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
      body: JSON.stringify({ objective: objective, departments: departments, sources: sources, agentModels: agentModels || {} })
    });
    var body = await resp.json().catch(function () { return {}; });
    if (!resp.ok || body.error) {
      throw new Error(body.error || ("Orchestration request failed (" + resp.status + ")"));
    }
    return body; // { result, model, usage, substitutions }
  }

  // Reads the caller's own workspace's rolling-24h Orchestrate usage
  // against its cap, straight from the DB (RLS lets a member read their
  // own workspace row and usage log) — no Edge Function round trip.
  // Returns null for the read-only demo workspace, where Orchestrate
  // isn't available at all.
  async function getUsage() {
    await ready;
    if (currentWorkspaceId === DEMO_WORKSPACE_ID) return null;
    var wsRes = await sb.from("workspaces").select("daily_orchestrate_limit").eq("id", currentWorkspaceId).maybeSingle();
    if (wsRes.error) throw wsRes.error;
    var limit = (wsRes.data && wsRes.data.daily_orchestrate_limit) || 20;
    var since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    var countRes = await sb.from("orchestrate_usage").select("id", { count: "exact", head: true })
      .eq("workspace_id", currentWorkspaceId).gte("called_at", since);
    if (countRes.error) throw countRes.error;
    return { used: countRes.count || 0, limit: limit };
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
  function renderTeamBody(body, team) {
    var membersHtml = team.members.map(function (m) {
      var mine = currentUser && m.user_id === currentUser.id;
      return "<div class='team-row'><div><span class='team-email'>" + m.email + (mine ? " (you)" : "") + "</span>" +
        "<span class='team-role'>" + m.role + "</span></div>" +
        (mine ? "" : "<button class='btn small ghost' data-remove-member='" + m.user_id + "' type='button'>Remove</button>") +
        "</div>";
    }).join("") || "<p class='muted'>No members yet.</p>";

    var invitesHtml = team.invites.map(function (inv) {
      return "<div class='team-row'><div><span class='team-email'>" + inv.email + "</span><span class='team-role'>pending</span></div>" +
        "<button class='btn small ghost' data-revoke-invite='" + inv.id + "' type='button'>Revoke</button></div>";
    }).join("") || "<p class='muted'>No pending invites.</p>";

    body.innerHTML =
      "<div class='team-section'><h4>Members</h4>" + membersHtml + "</div>" +
      "<div class='team-section'><h4>Pending invites</h4>" + invitesHtml + "</div>" +
      "<div class='team-section'><h4>Invite a teammate</h4>" +
      "<div class='team-invite-form'>" +
      "<input class='control' id='aiven-invite-email' type='email' placeholder='teammate@company.com' autocomplete='email'>" +
      "<button class='btn small' id='aiven-invite-btn' type='button'>Send invite</button>" +
      "</div>" +
      "<p class='hint'>They'll join this workspace automatically the next time they sign in with that email — no separate accept step.</p>" +
      "</div>";

    async function refresh() { renderTeamBody(body, await listTeam()); }

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

    var inviteBtn = body.querySelector("#aiven-invite-btn");
    var inviteInput = body.querySelector("#aiven-invite-email");
    var submitInvite = async function () {
      var email = inviteInput.value.trim();
      if (!email) { toast("Enter an email address first."); return; }
      inviteBtn.disabled = true;
      try {
        await inviteTeammate(email);
        toast("Invited " + email + " — they'll join automatically on their next sign-in.");
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
  async function openTeamModal() {
    closeTeamModal();
    var overlay = document.createElement("div");
    overlay.className = "aiven-modal-overlay";
    overlay.id = "aiven-team-modal-overlay";
    overlay.innerHTML =
      "<div class='aiven-modal'>" +
      "<div class='aiven-modal-head'><h3>" + currentWorkspaceName() + " — Team</h3>" +
      "<button class='aiven-modal-close' type='button' aria-label='Close'>&times;</button></div>" +
      "<div class='aiven-modal-body' id='aiven-team-body'><p class='muted'>Loading…</p></div>" +
      "</div>";
    document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeTeamModal(); });
    overlay.querySelector(".aiven-modal-close").addEventListener("click", closeTeamModal);
    var body = overlay.querySelector("#aiven-team-body");
    try {
      renderTeamBody(body, await listTeam());
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
        "<button class='btn small' id='auth-team-btn' type='button'>Team</button>" +
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
    updateAgentModel: updateAgentModel,
    savePolicy: savePolicy,
    decideApproval: decideApproval,
    decideShadowTool: decideShadowTool,
    addShadowTool: addShadowTool,
    addAudit: addAudit,
    resetState: resetState,
    orchestrate: orchestrate,
    getUsage: getUsage,
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
      switchWorkspace: switchWorkspace
    },
    team: {
      list: listTeam,
      invite: inviteTeammate,
      revokeInvite: revokeInvite,
      removeMember: removeMember
    }
  };
})(window);
