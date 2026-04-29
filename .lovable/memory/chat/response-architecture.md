---
name: response-architecture
description: 5-question backbone and 3-shell response contract for all chat replies (decision transparency + visual calm)
type: feature
---

# Response Architecture (Comms Renovation)

Every medium- or high-value reply implicitly answers five questions, in order:
1. What did I understand?
2. What did I determine?
3. What did I do?
4. What is uncertain or blocked?
5. What are the next best options?

These are NEVER printed. They are answered by selecting ONE shell, picked from the SignalEnvelope's `intent` and `interaction` buckets:

- **Shell A — None** (`interaction:concise` / trivial): plain prose, 1–3 sentences, no headings.
- **Shell B — Execution** (`intent:execute` or any tool was used): `## Done` → `## Result` → `## Blockers` (if any) → `## Next` (if useful).
- **Shell C — Advisory** (`intent:decide` / `intent:advise` / strategy): `## Bottom line` → `## What's driving it` → `## Tradeoffs` → `## Recommendation`.
- **Shell D — Default** (everything else medium-value): `## Answer` → `## Why` (if needed) → `## Status` (if state changed) → `## Next move` (if clear).

## Hard rules
- **Omit by default.** A heading with one filler line is worse than no heading. Fold up.
- No prompt echo, no filler openers ("Sure", "Great question", "Let me…").
- Lead with the conclusion. Reasoning after.
- One confidence register per reply. If SignalEnvelope `confidence` is `inferred` / `stale` / weaker, prepend `> Confidence: <level>` once. Never use the line when confidence is `confirmed`.
- No micro-sections (≤1 short line). No mixed shells.
- Destructive-action confirmations use Shell D with only `## Answer` + `## Next move`.

## Where it lives
- Prompt enforcement: `supabase/functions/chat/index.ts` → `buildSystemPrompt`, section "RESPONSE ARCHITECTURE".
- Visual rendering: `src/components/chat/MessageBubble.tsx` — `## H2`s render as quiet small-caps muted labels; `>` blockquotes render as a subtle confidence strip. No JSX changes.

## Goals
Clean, premium, calm, decisive, high-signal, non-repetitive. Avoid over-explaining, prompt repetition, micro-sections, mixed confidence, accidental verbosity.
