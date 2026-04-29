# Comms Renovation — Decision Transparency + Visual Calm

Goal: every medium/high-value reply answers the 5 questions (understood / determined / did / uncertain / next) using one of three response shells, rendered in a calm, premium way. Surgical changes only — no rewrites of the chat UI or routing layers.

## Part 1 — Response contract (backend, system prompt)

Add a single new section to `buildSystemPrompt` in `supabase/functions/chat/index.ts` (right after RESPONSE FORMATTING, ~line 6234), called **RESPONSE ARCHITECTURE**. It encodes:

**The 5 questions every reply implicitly answers** — understood, determined, did, uncertain, next.

**Three shells, model picks based on intent bucket from the SignalEnvelope:**

- `interaction:concise` or trivial → no shell, 1–3 sentences, plain.
- `intent:execute` (action taken / tool used) → **Execution shell**:
  - `## Done` (what was executed) → `## Result` (outcome + IDs/links) → `## Blockers` (only if any) → `## Next` (1–3 follow-ups, optional).
- `intent:decide` / `intent:advise` → **Advisory shell**:
  - `## Bottom line` → `## What's driving it` → `## Tradeoffs` → `## Recommendation`.
- everything else (medium-value answers) → **Default shell**:
  - `## Answer` → `## Why` (only if reasoning matters) → `## Status` (only if state changed) → `## Next move` (only if there's a clear next step).

**Hard rules baked into the prompt:**
- Never use all sections by default — omit any section that would be filler.
- No prompt echo. No "Great question". No restating what the user asked.
- One confidence register per reply (don't mix "definitely" + "might"). Use `> Confidence: confirmed | likely | inferred | stale` only when the SignalEnvelope's `confidence` bucket is `inferred` or weaker.
- Lead with the conclusion. Reasoning comes after.
- Skip micro-sections (≤1 line under a heading) — fold into the section above.
- For destructive/important actions: confirm first using the existing list-confirm-act protocol (no change), but the confirmation message itself uses the Default shell with just `## Answer` + `## Next move`.

This ties directly into the SignalEnvelope already injected at line ~8739 — the model already sees `intent` and `interaction` buckets, so shell selection is deterministic.

## Part 2 — Render layer (calm + premium)

Two surgical changes to `src/components/chat/MessageBubble.tsx`:

1. **Tighter prose rhythm** for assistant bubbles — extend the `prose-*` classes:
   - `prose-h2:text-[13px] prose-h2:font-semibold prose-h2:uppercase prose-h2:tracking-[0.08em] prose-h2:text-muted-foreground prose-h2:mt-4 prose-h2:mb-1.5`
   - `prose-h2:first:mt-0`
   - `prose-blockquote:border-l-2 prose-blockquote:border-primary/40 prose-blockquote:text-muted-foreground prose-blockquote:not-italic prose-blockquote:py-0 prose-blockquote:my-2 prose-blockquote:text-[12px]`
   - This makes the shell headings feel like quiet section labels, not loud H2s — the "premium calm" goal.

2. **Confidence quote styling** — the `>` blockquote pattern from the prompt renders as a subtle muted strip, never competing with the answer.

No structural changes, no new components, no layout shifts. Bubble width, spacing, orb, play button — all untouched.

## Part 3 — Memory + docs

- Create `mem://chat/response-architecture` capturing the 5 questions, three shells, and the omit-by-default rule. This is durable and applies to every reply.
- Add one line to `mem://index.md` Memories list pointing to it.
- Update `mem://chat/interface-design-philosophy` only if needed to reference the new doc (probably no edit required).

## What changes / what doesn't

```text
CHANGES
  supabase/functions/chat/index.ts        (one new prompt section, ~40 lines)
  src/components/chat/MessageBubble.tsx   (extended prose-* classes, no JSX change)
  .lovable/memory/chat/response-architecture.md   (new)
  .lovable/memory/index.md                (one new line)

UNCHANGED
  Signal envelope, dispatcher, routing, tool registry, voice, threads,
  ThreadView, Communications page, RealtimeVoiceChat — all untouched.
```

## Why this works

- The 5-question backbone lives in the prompt, not in code, so it scales across every model and every intent without UI branching.
- The three shells are picked by the model using signals already in scope (no new pipeline).
- Render changes are CSS-only, so we get visual calm without touching layout or breaking existing styling.
- "Omit-by-default" is the key anti-verbosity rule — it prevents the shells from becoming the over-structured wall of micro-sections you want to avoid.

Approve and I'll ship Part 1 + Part 2 + Part 3 in a single pass.
