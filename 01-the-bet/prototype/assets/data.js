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
  var authListeners = [];
  var resolveReady;
  var ready = new Promise(function (res) { resolveReady = res; });

  async function resolveWorkspaceId(userId) {
    for (var attempt = 0; attempt < 3; attempt++) {
      var r = await sb.from("workspace_members").select("workspace_id").eq("user_id", userId).limit(1).maybeSingle();
      if (r.error) throw r.error;
      if (r.data) return r.data.workspace_id;
      await new Promise(function (res) { setTimeout(res, 600); }); // auto-provision trigger racing us — retry briefly
    }
    return null;
  }

  async function handleAuthChange(session) {
    var user = session && session.user ? session.user : null;
    currentUser = user;
    if (user) {
      try {
        var wsId = await resolveWorkspaceId(user.id);
        currentWorkspaceId = wsId || DEMO_WORKSPACE_ID;
      } catch (e) {
        console.error("Aiven: failed to resolve workspace for signed-in user", e);
        currentWorkspaceId = DEMO_WORKSPACE_ID;
      }
    } else {
      currentWorkspaceId = DEMO_WORKSPACE_ID;
    }
    authListeners.forEach(function (fn) { try { fn(currentUser, currentWorkspaceId); } catch (e) { console.error(e); } });
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
  function onAuthChange(fn) {
    authListeners.push(fn);
    ready.then(function () { fn(currentUser, currentWorkspaceId); });
  }

  /* ---------------- auth widget (shared markup injected into every page) ---------------- */
  function renderAuthWidget(container) {
    if (!container) return;
    if (currentUser) {
      container.innerHTML =
        "<span class='auth-email' title='Signed in'>" + currentUser.email + "</span>" +
        "<button class='btn small' id='auth-signout-btn' type='button'>Sign out</button>";
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
      onChange: onAuthChange
    }
  };
})(window);
