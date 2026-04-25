# Conversation Issue Scan — Findings & Fix Plan

I read the chat edge-function logs and the database. Here is everything that actually went wrong vs. what the AI claimed.

## Issue 1 — The "intent_type check constraint" error was a hallucination
**What the AI said:** A Capability Gap Report claiming `create_work_task` was rejected by `work_tasks_intent_type_check`.

**What actually happened:** Logs show **4 successful `create_work_task` calls** in a row at 16:21:17–16:21:38. None failed. None even sent an `intent_type` argument — the handler defaulted to `'ops'` for all four (verified in DB: all rows have `intent_type='ops'`). There is no constraint failure anywhere in the logs.

**Root cause:** The Capability Gap Recovery prompt (added in `.lovable/plan.md`) is firing on success, fabricating a plausible-looking error report. The model is over-eager to produce the report whenever it touches a tool.

**Fix:** Tighten the gating language in `buildSystemPrompt` so the report is only emitted when a tool result's JSON contains `success: false`. Add an explicit anti-hallucination clause: *"Never invent an error. Only emit the report if you observed a `success: false` payload or an exception in this turn."*

## Issue 2 — Runaway task creation (4 tasks for one ebook)
**What happened:** The model created four overlapping tasks for the same ebook within 21 seconds:
- "Draft Ozlon ebook in Google Docs…"
- "Create final Google Doc for Ozlon ebook"
- "Draft assembled ebook copy and formatting"
- "Generate polished final Google Doc for ebook"

This burned tool-loop iterations on tracking instead of executing, contributing directly to Issue 3.

**Root cause:** The work-task system prompt encourages task creation but has no de-dup guard. The model splits a single goal into multiple tracking rows.

**Fix:** Add a single line to the work-task section of `buildSystemPrompt`: *"Create AT MOST ONE work task per user goal per turn. If a task for this goal already exists in this session, call `update_work_task` instead. Never split one user request into multiple parallel tasks."*

## Issue 3 — "Maximum number of steps" abort
**What happened:** The Lovable AI Gateway aborted the turn with *"hit the maximum number of steps."*

**Root cause:** Our tool loop has `maxIterations = 10` (line 7218 of `chat/index.ts`). Burning 4 iterations on duplicate `create_work_task` calls left no headroom for actually drafting + applying markdown to Google Docs (which needs at least: docs_list → docs_get → docs_apply_markdown → docs_format_as_report → 1 final reply ≈ 5+ iterations on its own).

**Fix:** Two-part:
1. Raise `maxIterations` from `10` to `20`. The OpenAI 128-tool ranker is the real safety bound; 10 is too tight for legitimate multi-step doc work.
2. Issue 2's de-dup guard reclaims 3 wasted iterations on its own.

## Files touched
| File | Change | Lines |
|---|---|---|
| `supabase/functions/chat/index.ts` | (a) Tighten Capability Gap Report gating to require observed `success: false`. (b) Add "one task per goal" rule in work-task prompt section. (c) Bump `maxIterations` default from 10 → 20. | ~15 lines total across 3 spots |

**One file. No DB changes. No new tools.** Deploy `chat` edge function after edit.

## Verification
1. Deploy `chat`.
2. Re-issue the ebook request. Confirm: a single work task is created, the doc is actually drafted, no fabricated Capability Gap Report appears on success.
3. Force a real failure (e.g. ask to send a Gmail to an invalid address) and confirm the report still fires correctly when `success: false` truly occurs.

## Why this is the right scope
Considered (a) removing the Capability Gap Report entirely — too aggressive, it's useful when accurate; (b) adding a DB-side dedupe constraint — wrong layer, the model should reason about its own task list. The prompt-only fix matches the universal-policy approach already chosen in `.lovable/plan.md`, plus a tiny iteration-cap bump.

---

**Approve and I'll execute.**