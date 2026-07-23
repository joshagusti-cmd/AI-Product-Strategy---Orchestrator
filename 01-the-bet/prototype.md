# The Prototype Bet

## What I Built
A clickable, one-page command-center prototype of the Aiven Agent Orchestrator: an executive enters a business objective, the orchestrator decomposes it into a task graph, assigns it across six specialized agents running on different models, pauses execution for human approval on a flagged risk, then produces a governed executive action plan with a full per-agent audit trail.

## Tool Used
Claude Code (Claude Sonnet 5) — hand-built single-file HTML/CSS/JS, no framework. Published as a Claude Artifact.

## Prototype Link
https://claude.ai/code/artifact/35c46725-ea55-4b4b-9a32-f4ab0388bf50

Source also lives in this repo at [`prototype/index.html`](prototype/index.html), so it can be lifted into a real app shell later without re-doing the interaction design.

## AI Value Archetype
Orchestrator — consistent with the Module 1 diagnostic. It doesn't compete with Claude or GPT on raw model capability; it coordinates and governs them.

## The Bet in One Sentence
<!-- DRAFT below — this is your call, not mine. Edit or replace before treating it as final. -->
Aiven becomes the independent, model-agnostic orchestration and governance layer that enterprises trust to coordinate, approve, and audit every AI agent working across their business — the operating layer that sits above Claude, GPT, and whatever ships next.

## Kill Criteria
<!-- DRAFT below — same caveat. -->
Kill this bet if, after 3–5 real enterprise pilots, buyers consistently treat governance/orchestration as a feature they expect bundled free into OpenAI's, Microsoft's, or Google's own agent platforms rather than something worth paying an independent vendor to own — or if switching cost stays low enough that a customer could replicate the approval-and-audit workflow in a spreadsheet within a week.
