---
name: Formatting Engine 2026
description: Six-mode formatting router + Phase 2 self-check verifier. Router picks one mode per turn and injects only that mode's rule card. Verifier post-checks DOCUMENT/LONGFORM output against per-mode checklists and optionally repairs.
type: feature
---
# Formatting Engine

Replaces three competing prompt blocks (RESPONSE FORMATTING, RESPONSE ARCHITECTURE, FORMATTING CONTRACT TWO MODES) with one deterministic router + one verifier.

## Modes
- **ATOMIC** — 1 sentence, no markdown. Greetings, acks, ultra-short.
- **CHAT** — 1–3 short paras, light bold. Default conversational.
- **BRIEF** — Answer / Why / Next move. Questions, advisory.
- **EXECUTION** — Done / Result / Blockers / Next. Any turn that used tools.
- **DOCUMENT** — H1 + subtitle + Exec Summary + … + Recommendations. Explicit "write me a {doc}".
- **LONGFORM** — Scripts, essays, teleprompters. Handled by `_longform/prompt.ts`.

## Router precedence (`_format/router.ts`)
1. `isLongForm` (from `_longform/detect.ts`) → LONGFORM
2. `willUseTools` → EXECUTION
3. doc verb + doc noun → DOCUMENT
4. atomic patterns / short non-question → ATOMIC
5. question / advisory intent / long input → BRIEF
6. default → CHAT

## Phase 2 — Self-check verifier (`_format/verify.ts`)
Runs AFTER generation. Cheap pass (default `google/gemini-3-flash-lite-preview`, ~200-400ms) that checks the assistant's final text against the chosen mode's checklist. Scales to all 6 modes via a per-mode checklist registry (`MODE_CHECKLISTS`).

Operating modes (env-controlled, hot-swappable):
- `FORMAT_VERIFIER_MODE=off` — disabled
- `FORMAT_VERIFIER_MODE=shadow` — **default**, runs check, emits telemetry, never repairs
- `FORMAT_VERIFIER_MODE=active` — runs check, requests repair when ok=false, emits `message_replacement`

Other env vars:
- `FORMAT_VERIFIER_MODES` (default `DOCUMENT,LONGFORM`) — which modes to verify
- `FORMAT_VERIFIER_MODEL` (default `google/gemini-3-flash-lite-preview`)
- `FORMAT_VERIFIER_MIN_CHARS` (default `200`) — skip short outputs

Adding a new mode to the verifier = adding one entry to `MODE_CHECKLISTS` in `verify.ts` and one entry to `FORMAT_VERIFIER_MODES`. No code changes needed elsewhere.

## SSE events emitted
- `formatting` — `{ mode, reason }` — router decision, sent up-front
- `formatting_verify` — `{ mode, op_mode, ok, issues[], latency_ms, model, skipped?, repaired }` — verifier result
- `message_replacement` — `{ mode, text }` — only when `op_mode=active` and repair returned

Wired in both the streaming path and the tool-loop path in `supabase/functions/chat/index.ts`.

## Visual grammar (shared across CHAT/BRIEF/EXECUTION/DOCUMENT)
- Bold only for names/numbers/decisions. Never full sentences.
- Tables only for 3+ row comparisons.
- One pull-quote per reply max.
- Code fences only for code/IDs/paths.
- No emojis. No filler openers.
- Lead with the answer.

## Rollout state
- Phase 1 (router + cards + visual grammar): SHIPPED
- Phase 2 (verifier): SHIPPED in shadow mode by default. Flip `FORMAT_VERIFIER_MODE=active` to enable repair.
- Phase 3 (telemetry table + tuning): pending — currently logs only via console + SSE.
