/* =========================================================================
   Aiven Orchestrator — shared backend client + chrome behavior (Horizon 1)

   Real, shared, persistent data via Supabase Postgres — replaces the old
   localStorage simulation. Every visitor to these pages reads and writes
   the same database. No auth yet (Horizon 2 per the roadmap): RLS is on,
   but permissive, so the public anon key can read/write freely. That's a
   real security tradeoff, documented in 01-the-bet/prototype.md — fine
   for a design-partner demo, not for production multi-tenant use.

   The Command Center's "Orchestrate" run calls a real Claude model
   through a Supabase Edge Function (see supabase/functions/orchestrate)
   instead of a scripted timeline.
   ========================================================================= */
(function (global) {
  "use strict";

  var SUPABASE_URL = "https://uqgdruekuwitjwyotdud.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_p18dpRJSewtzNn0mLS4GCw_4A3p1qLJ";
  var ORCHESTRATE_FUNCTION_URL = SUPABASE_URL + "/functions/v1/orchestrate";

  if (!global.supabase || !global.supabase.createClient) {
    console.error("Aiven: supabase-js failed to load — check the CDN <script> tag on this page.");
  }
  var sb = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
    var results = await Promise.all([
      sb.from("agents").select("*").order("name"),
      sb.from("policies").select("*").order("id"),
      sb.from("approvals").select("*").order("requested_at", { ascending: false }),
      sb.from("shadow_tools").select("*").order("found_at"),
      sb.from("audit_log").select("*").order("ts", { ascending: false }).limit(300)
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

  /* ---------------- writes ---------------- */
  async function updateAgentModel(id, model) {
    var r = await sb.from("agents").update({ model: model, updated_at: new Date().toISOString() }).eq("id", id);
    if (r.error) throw r.error;
  }

  async function savePolicy(id, patch) {
    var r = await sb.from("policies").update({
      autonomy: patch.autonomy, risk_threshold: patch.riskThreshold, escalation: patch.escalation,
      updated_at: new Date().toISOString()
    }).eq("id", id);
    if (r.error) throw r.error;
  }

  async function decideApproval(id, decision) {
    var r = await sb.from("approvals").update({ status: decision, decided_at: new Date().toISOString() }).eq("id", id);
    if (r.error) throw r.error;
  }

  async function decideShadowTool(id, decision) {
    var r = await sb.from("shadow_tools").update({ decision: decision }).eq("id", id);
    if (r.error) throw r.error;
  }

  async function addShadowTool(tool) {
    var r = await sb.from("shadow_tools").insert({
      id: tool.id, name: tool.name, owner: tool.owner, risk: tool.risk,
      decision: "undecided", note: tool.note
    });
    if (r.error) throw r.error;
  }

  async function addAudit(entry) {
    var r = await sb.from("audit_log").insert({
      actor: entry.actor, action: entry.action, model: entry.model || null,
      risk: entry.risk && entry.risk !== "—" ? entry.risk : null, detail: entry.detail || null
    });
    if (r.error) throw r.error;
  }

  async function resetState() {
    var r = await sb.rpc("reseed_demo_data");
    if (r.error) throw r.error;
  }

  /* ---------------- real model call ---------------- */
  async function orchestrate(objective, departments, sources) {
    var resp = await fetch(ORCHESTRATE_FUNCTION_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "authorization": "Bearer " + SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ objective: objective, departments: departments, sources: sources })
    });
    var body = await resp.json().catch(function () { return {}; });
    if (!resp.ok || body.error) {
      throw new Error(body.error || ("Orchestration request failed (" + resp.status + ")"));
    }
    return body; // { result, model, usage }
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

  /* ---------------- shared chrome: theme, clock, nav highlight, reset ---------------- */
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
        if (!global.confirm("Reset the shared database back to its seeded state? This clears every approval, policy edit, and audit entry anyone has added.")) return;
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
  }

  global.Aiven = {
    loadState: loadState,
    updateAgentModel: updateAgentModel,
    savePolicy: savePolicy,
    decideApproval: decideApproval,
    decideShadowTool: decideShadowTool,
    addShadowTool: addShadowTool,
    addAudit: addAudit,
    resetState: resetState,
    orchestrate: orchestrate,
    timeAgo: timeAgo,
    timeClock: timeClock,
    toast: toast,
    initChrome: initChrome
  };
})(window);
