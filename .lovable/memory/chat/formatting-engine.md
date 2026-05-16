---
name: Formatting Engine 2026
description: Six-mode formatting router (ATOMIC/CHAT/BRIEF/EXECUTION/DOCUMENT/LONGFORM) injected as a single addendum after the global system prompt. Each turn picks exactly one mode and gets only that mode's rule card plus shared visual grammar.
type: feature
---
# Formatting Engine

Replaces three competing prompt blocks (RESPONSE FORMATTING, RESPONSE ARCHITECTURE, FORMATTING CONTRACT TWO MODES) with one deterministic router.

## Modes
- **ATOMIC** — 1 sentence, no markdown. Greetings, acks, ultra-short.
- **CHAT** — 1–3 short paras, light bold. Default conversational.
- **BRIEF** — Answer / Why / Next move. Questions, advisory.
- **EXECUTION** — Done / Result / Blockers / Next. Any turn that used tools.
- **DOCUMENT** — H1 + subtitle + Exec Summary + … + Recommendations. Explicit "write me a {doc}".
- **LONGFORM** — Scripts, essays, teleprompters. Handled by `_longform/prompt.ts`.

## Router precedence
1. `isLongForm` (from `_longform/detect.ts`) → LONGFORM
2. `willUseTools` → EXECUTION
3. doc verb + doc noun → DOCUMENT
4. atomic patterns / short non-question → ATOMIC
5. question / advisory intent / long input → BRIEF
6. default → CHAT

## Files
- `supabase/functions/chat/_format/router.ts`
- `supabase/functions/chat/_format/cards.ts`
- Injected in `supabase/functions/chat/index.ts` right after the longform block (~line 9812).
- Emits `event: formatting` SSE with `{ mode, reason }` in both streaming and tool-loop paths.

## Visual grammar (shared across CHAT/BRIEF/EXECUTION/DOCUMENT)
- Bold only for names/numbers/decisions. Never full sentences.
- Tables only for 3+ row comparisons.
- One pull-quote per reply max.
- Code fences only for code/IDs/paths.
- No emojis. No filler openers.
- Lead with the answer.
