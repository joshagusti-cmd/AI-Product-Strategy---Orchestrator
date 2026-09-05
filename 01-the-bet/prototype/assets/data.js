/* =========================================================================
   Aiven Orchestrator — shared simulated data layer + chrome behavior
   Persists to localStorage so state survives reload and carries across
   pages (approve something here, see it logged in the audit trail there).
   This is a client-side simulation, not a real backend — see
   01-the-bet/prototype.md for what "real" would require.
   ========================================================================= */
(function (global) {
  "use strict";

  var STORAGE_KEY = "aiven_orchestrator_state_v1";

  function nowIso() { return new Date().toISOString(); }
  function rel(minutesAgo) { return new Date(Date.now() - minutesAgo * 60000).toISOString(); }

  function defaultState() {
    return {
      seededAt: nowIso(),
      agents: [
        { id: "research", name: "Research & Data Agent", dept: "Operations", tier: "Core", model: "Claude Sonnet 5", status: "Active",
          can: "Pulls and reconciles data across connected systems", cannot: "Cannot write to source systems or contact external parties",
          approval: "None — advisory only", reviewed: "2026-08-14" },
        { id: "finance", name: "Finance Agent", dept: "Finance", tier: "Core", model: "GPT-4o", status: "Active",
          can: "Analyzes cost structure, margin, and variance", cannot: "Cannot alter financial records or authorize spend",
          approval: "None — advisory only", reviewed: "2026-08-14" },
        { id: "ops", name: "Operations Agent", dept: "Operations", tier: "Core", model: "Claude Sonnet 5", status: "Active",
          can: "Maps process cycle times and bottlenecks", cannot: "Cannot modify workflow configuration",
          approval: "None — advisory only", reviewed: "2026-08-11" },
        { id: "strategy", name: "Strategy Agent", dept: "Executive", tier: "Core", model: "GPT-4o", status: "Active",
          can: "Synthesizes findings into prioritized recommendations", cannot: "Cannot publish externally without Writer + Compliance sign-off",
          approval: "None — advisory only", reviewed: "2026-08-11" },
        { id: "writer", name: "Executive Writer Agent", dept: "Executive", tier: "Core", model: "Claude Sonnet 5", status: "Active",
          can: "Drafts governed executive deliverables", cannot: "Cannot distribute outside the reviewing workspace",
          approval: "Human sign-off before external distribution", reviewed: "2026-08-11" },
        { id: "scanning", name: "Scanning Agent", dept: "Fraud Ops", tier: "Leader", model: "Claude Haiku 4.5", status: "Active",
          can: "Scores every transaction for scam likelihood, applies flags", cannot: "Cannot contact customers, generate documents, or act beyond scoring",
          approval: "None — fully autonomous, advisory score only", reviewed: "2026-08-20" },
        { id: "context", name: "Context Agent", dept: "Fraud Ops", tier: "Filler", model: "Claude Sonnet 5", status: "Active",
          can: "Pulls related account/merchant history, drafts a contextual summary", cannot: "Cannot alter the risk score, start a dispute, or send anything externally",
          approval: "None to generate — output advisory-only for the analyst", reviewed: "2026-08-20" },
        { id: "dispute", name: "Dispute Agent", dept: "Fraud Ops", tier: "Killer", model: "Claude Opus 4.8", status: "Review",
          can: "Drafts a dispute-letter template once triggered", cannot: "Cannot generate without a trigger, or send without a second confirmation",
          approval: "Explicit analyst approval to generate, separate approval to send", reviewed: "2026-08-22" },
        { id: "compliance", name: "Compliance / Audit Agent", dept: "Risk & Compliance", tier: "Core", model: "Claude Opus 4.8", status: "Active",
          can: "Logs every action to the audit trail, monitors drift/hallucination, flags overrides", cannot: "Cannot override an analyst decision or block an action unilaterally",
          approval: "N/A — flags, never decides", reviewed: "2026-08-22" }
      ],
      policies: [
        { id: "leader", tier: "Leader", label: "Leader tier — Scanning", autonomy: "Autonomous", riskThreshold: 62,
          escalation: "Auto-escalate to Filler tier + analyst approval queue when a transaction's score crosses the threshold.", updatedAt: "2026-08-20" },
        { id: "filler", tier: "Filler", label: "Filler tier — Context", autonomy: "Advisory", riskThreshold: 75,
          escalation: "Generates automatically; advisory-only for the analyst. An analyst override of a High flag routes to a second reviewer.", updatedAt: "2026-08-20" },
        { id: "killer", tier: "Killer", label: "Killer tier — Dispute", autonomy: "Two-gate", riskThreshold: 90,
          escalation: "Requires an explicit analyst approval to generate, and a separate explicit approval to send. Never a single-click autonomous action.", updatedAt: "2026-08-22" },
        { id: "compliance", tier: "Core", label: "Cross-cutting — Compliance/Audit", autonomy: "Advisory", riskThreshold: 50,
          escalation: "Any Reliability Contract alert threshold breach (hallucination rate, drift velocity, accuracy) routes to the compliance/audit owner, not just the analyst queue.", updatedAt: "2026-08-22" }
      ],
      approvals: [
        { id: "ap1", title: "Publish Q3 Vendor Risk Review to Legal workspace", agent: "Risk & Compliance Agent", dept: "Operations", risk: "Medium", requestedAt: "6h ago", status: "pending" },
        { id: "ap2", title: "Grant Finance Agent read access to Q4 forecast model", agent: "Orchestrator Core", dept: "Finance", risk: "Low", requestedAt: "1d ago", status: "pending" },
        { id: "ap3", title: "Generate dispute-letter template for txn #48213 (gate 1 of 2)", agent: "Dispute Agent", dept: "Fraud Ops", risk: "High", requestedAt: "38m ago", status: "pending" },
        { id: "ap4", title: "Send approved dispute letter to cardholder for txn #47950 (gate 2 of 2)", agent: "Dispute Agent", dept: "Fraud Ops", risk: "High", requestedAt: "2h ago", status: "pending" },
        { id: "ap5", title: "Reverse High-risk flag on txn #48007 per analyst override", agent: "Compliance / Audit Agent", dept: "Fraud Ops", risk: "Medium", requestedAt: "4h ago", status: "pending" }
      ],
      shadowTools: [
        { id: "sh1", name: "Personal ChatGPT accounts used by analysts to draft dispute letters by hand", owner: "Fraud Ops (unmanaged)", risk: "High", decision: "kill",
          note: "Replaced by the governed Dispute Agent flow — real customer PII was being pasted into an ungoverned consumer tool." },
        { id: "sh2", name: "Legacy rules-based fraud scoring vendor (pre-Orchestrator)", owner: "Fraud Ops", risk: "Medium", decision: "govern",
          note: "Kept running in parallel during rollout as a fallback/comparison baseline; brought under the same audit logging." },
        { id: "sh3", name: "Spreadsheet macro analysts use to track prior disputes manually", owner: "Individual analysts (informal)", risk: "Low", decision: "govern",
          note: "Migrating what it holds into the golden dataset / Network Intelligence loop instead of leaving it siloed on someone's laptop." }
      ],
      shadowScanCount: 0,
      auditLog: [
        { ts: rel(2), actor: "Compliance / Audit Agent", action: "Flagged reliability alert — Filler-tier drift 4.2% vs. golden-dataset baseline", model: "Claude Opus 4.8", risk: "Medium", detail: "Within tolerance, routed to compliance/audit owner for review." },
        { ts: rel(20), actor: "Dispute Agent", action: "Drafted dispute-letter template for txn #48213", model: "Claude Opus 4.8", risk: "High", detail: "Pending gate 1 of 2 analyst approval before generation is finalized." },
        { ts: rel(55), actor: "Scanning Agent", action: "Scored transaction #48210 — scam likelihood 0.31", model: "Claude Haiku 4.5", risk: "Low", detail: "Below escalation threshold; no human action required." },
        { ts: rel(90), actor: "Scanning Agent", action: "Scored transaction #48207 — scam likelihood 0.74", model: "Claude Haiku 4.5", risk: "High", detail: "Crossed risk threshold — auto-escalated to Filler tier." },
        { ts: rel(94), actor: "Context Agent", action: "Drafted contextual summary for txn #48207", model: "Claude Sonnet 5", risk: "High", detail: "Landed in the analyst approval queue for review." },
        { ts: rel(150), actor: "Human reviewer", action: "Approved redaction & inclusion policy for Q3 Vendor Risk Review", model: "—", risk: "—", detail: "Gate cleared; deliverable released to the executive workspace." },
        { ts: rel(210), actor: "Orchestrator Core", action: "Reassigned Finance Agent from Claude Sonnet 5 to GPT-4o", model: "GPT-4o", risk: "—", detail: "Governance policy re-evaluated automatically after model swap." },
        { ts: rel(260), actor: "Compliance / Audit Agent", action: "Killed shadow AI tool: personal ChatGPT use by Fraud Ops analysts", model: "—", risk: "High", detail: "Real customer PII was being pasted into an ungoverned consumer tool." },
        { ts: rel(320), actor: "Human reviewer", action: "Reversed High-risk flag on txn #48001 (analyst override)", model: "—", risk: "Medium", detail: "Routed to a second reviewer per escalation policy." },
        { ts: rel(400), actor: "Dispute Agent", action: "Sent approved dispute letter to cardholder for txn #47822", model: "Claude Opus 4.8", risk: "High", detail: "Gate 2 of 2 cleared by a second explicit analyst approval." },
        { ts: rel(480), actor: "Kill-switch drill", action: "Verified secondary-provider swap under simulated load", model: "—", risk: "—", detail: "34-minute failover — within the <48h Ready target." },
        { ts: rel(600), actor: "Orchestrator Core", action: "Weekly reliability sampling completed", model: "—", risk: "Low", detail: "Leader-tier accuracy 92.4% — at target. No drift alert raised." }
      ]
    };
  }

  function loadState() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        var seeded = defaultState();
        global.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
        return seeded;
      }
      return JSON.parse(raw);
    } catch (e) {
      return defaultState();
    }
  }

  function saveState(state) {
    try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode etc — degrade silently */ }
  }

  var state = loadState();

  function getState() { return state; }

  function setState(mutator) {
    mutator(state);
    saveState(state);
  }

  function addAudit(entry) {
    entry.ts = entry.ts || nowIso();
    state.auditLog.unshift(entry);
    if (state.auditLog.length > 300) state.auditLog.length = 300;
    saveState(state);
  }

  function resetState() {
    try { global.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    state = loadState();
  }

  /* ---------------- time formatting ---------------- */
  function timeAgo(iso) {
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
      resetBtn.addEventListener("click", function () {
        if (global.confirm("Reset all demo data back to the seeded state? This clears every approval, policy edit, and audit entry you've added in this browser.")) {
          resetState();
          global.location.reload();
        }
      });
    }
  }

  global.Aiven = {
    getState: getState,
    setState: setState,
    addAudit: addAudit,
    resetState: resetState,
    timeAgo: timeAgo,
    timeClock: timeClock,
    toast: toast,
    initChrome: initChrome
  };
})(window);
