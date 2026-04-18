
User wants to continue the roadmap. Phase 0 (tiered prioritizer) ✅, Phase 4 (proactive memory) ✅, Phase 1 (semantic routing booster) ✅. Remaining: Phase 2 (consolidation — deferred, risky), Phase 3 (two-pass agentic routing), Phase 5 (self-evolution).

Phase 3 is the highest-leverage next step — it's the actual "sentient feel" upgrade and builds directly on the prioritizer work we just shipped. Phase 2 is mechanical refactoring with regression risk; Phase 5 needs more behavioral data first.

Recommend Phase 3.

# Phase 3 — Two-Pass Agentic Routing

## What it does
Splits one bloated LLM call into two focused calls:
1. **Planner** (gpt-5-mini, fast/cheap): sees user message + Wisdom memories. Outputs a short JSON plan: *"intent: X, steps: [check_email, cross_ref_calendar, draft_reply], integrations: [gmail, calendar]"*
2. **Executor** (gpt-5.4): receives the plan + only tools matching the planned integrations. Executes, narrates, completes.

## Why it's the right next step
- **Solves silent tool-drop permanently** — executor only ever sees ~30-40 relevant tools, far below the 128 cap, regardless of how many we add later
- **Makes reasoning visible** — plan renders in existing `TaskActivityPortal` (already built)
- **Enables long horizons** — 8+ tool calls per turn become reliable; today they get confused
- **Compounds Phase 0/1/4** — planner consumes proactive memory, executor consumes prioritized tools

## Scope (one file: `supabase/functions/chat/index.ts`)

**1. Add `runPlannerPass()` before `runToolLoop()`:**
- Calls Lovable AI gateway with gpt-5-mini
- System prompt: "Output JSON: {intent, steps[], integrations[], needsTools: bool}"
- ~200 token response, <1s latency
- If `needsTools: false` → skip planner, go direct to executor (chitchat fast path)

**2. Feed plan into existing prioritizer:**
- Plan's `integrations[]` becomes the strongest Tier A signal (overrides keyword detection)
- Plan's `intent` injected into executor system prompt as: *"Plan: [step1, step2, step3]. Execute in order."*

**3. Stream plan to UI via existing SSE `task_update` events:**
- `TaskActivityPortal` already renders these — zero UI work
- Each step in plan emits a `task_update` with status `pending` → `in_progress` → `done`

**4. Fast-path bypass:**
- If user message <40 chars and matches conversational patterns ("hi", "thanks", "what can you do") → skip planner entirely, preserve current latency

## What we don't touch
- No DB changes
- No UI changes (TaskActivityPortal already exists)
- No new edge functions
- Existing single-pass flow remains as fallback if planner fails

## Verification
After deploy, hit `/functions/v1/chat` for:
- Complex multi-integration: "check my unread emails and add followups to my GHL pipeline" → plan should list `[gmail, ghl]`, executor only loads those tools
- Simple chitchat: "hey" → planner skipped, latency unchanged
- Single integration: "show my GSC traffic" → plan lists `[gsc]`, ~6 tools loaded
- Failure mode: planner returns malformed JSON → falls back to current single-pass behavior

## Effort
~150-200 lines in `chat/index.ts`. One session. Zero regression risk (graceful fallback to existing flow).

## After Phase 3
- **Phase 5 (self-evolution)** becomes viable because plans are now structured/loggable data the system can learn from
- **Phase 2 (consolidation)** becomes optional — executor only sees ~30 tools per turn anyway
