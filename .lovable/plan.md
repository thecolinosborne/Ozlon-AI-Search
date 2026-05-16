## Formatting Engine 2026 — unify how every reply looks

Right now the chat function has **three overlapping formatting layers** that fight each other:

1. `RESPONSE FORMATTING` (always-on markdown rules) — line ~6580
2. `RESPONSE ARCHITECTURE` (Shells A/B/C/D) — line ~6595
3. `FORMATTING CONTRACT — TWO MODES` (Conversational vs Document) — line ~6713

Plus the new `_longform/prompt.ts` addendum for scripts. They overlap, contradict (e.g. "always use ## headings" vs "no headings for short replies"), and the model picks whichever it sees last — which is why outputs feel inconsistent (sometimes over-structured, sometimes wall-of-text, sometimes mid-DOCUMENT shell for a casual question).

This plan collapses all of that into **one Formatting Engine** with deterministic mode selection, mode-scoped rules, and a small self-check pass.

---

### Layer 1 — Single Mode Router (deterministic, server-side)

Replace the three competing prompt blocks with one router that classifies each turn into exactly **one** of six modes before the LLM ever sees the system prompt. The mode is computed in `chat/index.ts` from intent + message + tool plan, and only the rules for that one mode are injected.

```text
ATOMIC      → 1 sentence, no markdown          (greetings, yes/no, ack)
CHAT        → 1–3 short paras, light bold      (default conversational)
BRIEF       → Answer → Why → Next (Shell D)    (medium Q&A, advisory)
EXECUTION   → Done / Result / Blockers / Next  (any reply that used tools)
DOCUMENT    → H1 + subtitle + Exec Summary…    (explicit "write me a X")
LONGFORM    → script/essay/teleprompter        (already built in _longform)
```

Mode is decided by: intent bucket from SignalEnvelope → longform detector → document keywords → tool-used flag → length of user message. One winner, no blending.

### Layer 2 — Mode-scoped rule cards

Each mode gets its own ~15-line rule card. Cards include only what applies. No global "ALWAYS use ## headings" rule — that becomes a CHAT/BRIEF/DOCUMENT rule, not an ATOMIC one. The 14-word sentence cap is scoped to ATOMIC + CHAT (already partially done for longform).

### Layer 3 — Visual grammar tokens (consistent across modes)

A shared "visual grammar" block defines *how* each markdown element is used, so output looks the same whether it's a BRIEF or a DOCUMENT:

- **Bold** = nouns the user must not miss (names, numbers, decisions). Never whole sentences.
- *Italic* = subtitle, aside, work titles, soft emphasis.
- `####` eyebrow labels for sections inside DOCUMENT/LONGFORM only.
- Tables for 3+ row comparisons, never for 2 items.
- `>` blockquote = exactly one pull-quote per reply, max.
- Code fences only for code/IDs/paths/payloads — never for prose.
- Spacing: blank line between every block; no orphan headings.

### Layer 4 — Self-check pass (cheap, optional)

After generation, a 1-pass verifier (`gemini-3-flash-lite`, ~200ms) checks the reply against the chosen mode's card and the visual grammar. Failures trigger one surgical repair. Off by default; flag-gated to enable on DOCUMENT + LONGFORM first.

### Layer 5 — Mode telemetry

Emit `formatting` SSE event with `{ mode, applied_rules, repaired }` so we can see in logs which mode each turn picked and tune the router from real data.

---

### Files touched

- `supabase/functions/chat/_format/router.ts` — new, mode classifier
- `supabase/functions/chat/_format/cards.ts` — new, the 6 rule cards + shared visual grammar
- `supabase/functions/chat/_format/verify.ts` — new, optional self-check
- `supabase/functions/chat/index.ts` — replace lines ~6580–6770 (3 competing blocks) with a single `injectFormattingContract(mode)` call; emit `formatting` SSE event
- `supabase/functions/chat/_longform/prompt.ts` — keep, but registered as the LONGFORM card
- `mem://chat/formatting-engine` — new memory documenting the 6 modes and visual grammar
- `mem://design/voice-and-vocabulary` — update: 14-word cap scoped to ATOMIC+CHAT only

### Rollout

- **Phase 1 (ship first):** Layers 1–3 (router + cards + visual grammar). This alone fixes ~80% of inconsistency because the model stops seeing contradictory rules.
- **Phase 2:** Layer 4 verifier on DOCUMENT + LONGFORM.
- **Phase 3:** Layer 5 telemetry → tune router thresholds from real turns.

### Open choices for you

1. Keep **DOCUMENT MODE's H1 + Executive Summary skeleton** rigid, or make it adaptive (only when the doc is >400 words)?
2. **Self-check verifier** on at launch for DOCUMENT/LONGFORM, or ship dark for a week first?
3. Want a user-visible **"Reformat as → Brief / Doc / Script / Chat"** chip on every assistant message, so the user can rerender a reply in a different mode without retyping?