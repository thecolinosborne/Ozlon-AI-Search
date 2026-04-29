---
name: The Stack — unified actionable inbox
description: /stack route merges signals + comm priorities + captures into one ranked, checkable inbox. Phase 1 is UI-only over signal_moments.
type: feature
---

## What it is

**The Stack** (`/stack`) is the canonical actionable surface — one true source for everything that needs the user. It merges three existing systems into a single normalized view:

1. AI signals (`signal_moments` table)
2. Communications priorities (`useCommunicationsFeed().digest.priorities`)
3. User captures (`signal_moments` with `kind='user_created'`)

`/signals` and `/communications` remain as input-channel pages — they continue to populate The Stack but are not removed.

## Core primitives

- **`useStack()`** — `src/hooks/useStack.ts`. Pure client merge, no new edge function. Returns normalized `StackItem[]`, `StackGroups` (now/soon/later/snoozed/doneToday), and uniform actions (`complete / snooze / dismiss / runAgent / openSource` plus `bulk*` variants).
- **Urgency engine** — score = 0.35·salience + 0.20·timeProximity + 0.15·sourceWeight + 0.10·modeFit + 0.05·streak. Bands: ≥0.75 high, ≥0.45 medium, else low. Recomputed client-side every render.
- **Dedup** — same-headline collisions: comm rows win over signal/capture for the same headline; collapsed siblings stored in `signalRefs`.

## UI rules (calm Vision-Pro aesthetic)

- One `StackRow` template across all sources. Source shown as a muted chip.
- Single 2px left stripe per urgency: `amber-500/40` high, `primary/30` medium, none low. **Never bright fills.**
- Round checkbox left → tap = optimistic strikethrough → 280ms → fire complete → 400ms collapse.
- Long-press (500ms) or shift-click → multi-select; selection bar (Complete · 1h · Tomorrow · Dismiss) uses same `bg-card/50 backdrop-blur-2xl` as `SignalsBanner`.
- Swipe right = done, swipe left = snooze 1h (mobile, via `useSwipeActions`).
- Undo toast (sonner, 5s) on every destructive action.
- "Cleared today · N / total" thin progress strip at top.

## Phase 2+ (deferred — not yet built)

- Migration: add `due_at / snoozed_until / completed_at / parent_id / pinned_at` to `signal_moments`; new `stack_daily_summary` table.
- Snooze/due cron in `scheduled-routines`.
- Inline agent chip with skill matching + runtime estimate (Phase 1 has the chip via `agentSuggestion`, Phase 3 generalizes).
- `Cmd+K` capture via `CommandPalette`; voice-capture confirmation.
- Morning brief / evening clear rituals via `BriefMeOverlay` + TTS.
- Reflection-note feedback loop for self-tuning weights.

## Constraints

- **No `/tasks` route or task store.** The Stack is a *view* over `signal_moments`, not a new entity. Honours the no-Tasks-page rule.
- **Comm priorities are read-only projections.** Phase 1 cannot mark comm rows complete persistently — those handlers are no-ops. Pinning (Phase 2+) is the one moment a comm row writes a derived `signal_moments` row with `kind='comm_pinned'`.
- Additive only: `useSignals`, `signals-create`, `signals-feedback`, `FocusStack`, `SignalsBanner` all unchanged.
