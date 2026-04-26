# Signals Section — Upgrade Plan

## Why it shows only one signal

Two stacked limits collapse the surface to a single moment:

1. `src/pages/Signals.tsx` passes `maxMoments={1}` to `<SignalSurface variant="page" />`.
2. `src/hooks/useSignals.ts` query is hard-capped at `.limit(3)`.

Meanwhile the database currently holds **19 live moments** for the active user (many near-duplicate "ad production stalled" reflections from 20:29 → 22:40 today), so the dedup pass in `signals-synthesize` is also under-tuned.

## Changes

### 1. `src/hooks/useSignals.ts`
- Raise query limit from `3` → `12`.
- Add a new `dismissAll()` helper that batch-marks all live moments `dismissed` (single update + optimistic clear).
- Add `refresh()` alias exposing `load()` so the page can pull-to-refresh.

### 2. `src/pages/Signals.tsx`
- Replace single-moment hero with a **two-pane layout**:
  - **Top:** featured top moment (current minimalist hero, kept intact — additive).
  - **Below:** quiet stacked list of remaining live moments (kind chip · headline · salience · time · Handle / Dismiss inline actions).
- Header row gains a small "Listening…" status, **Refresh**, and **Clear all** buttons (calm, ghost-styled, no emoji).
- Empty state preserved verbatim.

### 3. `src/components/signals/SignalSurface.tsx`
- New optional prop `showList?: boolean` (default `false` — keeps every existing call site untouched).
- When `variant="page"` and `showList`, render the list section beneath the hero using existing `BreathingDot` and tone tokens.
- Keep `maxMoments` semantics: hero still uses `maxMoments`; list uses everything past it.

### 4. `supabase/functions/signals-synthesize/index.ts` (dedup tightening)
- Lower `match_signal_moments` similarity threshold from `0.88` → `0.82` so the repeating "ad production stalled" cluster collapses into one live moment.
- When a near-duplicate is detected, mark the older one `superseded` (already supported by the schema) instead of dropping the new one — keeps the freshest phrasing.
- No prompt or model changes; behaviour stays calm.

### 5. One-time cleanup migration
- Mark the 18 older duplicates from today as `superseded` so the new UI opens with a clean slate. Migration is idempotent (`status = 'live' AND created_at < now() - interval '15 minutes'` against the duplicate cluster keys).

## Out of scope
- No redesign of the indicator/inline/voice variants.
- No changes to `signals-feedback`, `signals-tune`, or cron jobs.
- No new tables or RLS changes.

## Files touched
- `src/hooks/useSignals.ts` *(edit)*
- `src/pages/Signals.tsx` *(edit)*
- `src/components/signals/SignalSurface.tsx` *(edit, additive prop)*
- `supabase/functions/signals-synthesize/index.ts` *(edit — dedup threshold + supersede)*
- `supabase/migrations/<timestamp>_signals_supersede_cleanup.sql` *(new, one-time)*

## Verification
- Reload `/signals` → hero + list of remaining live moments visible, count matches DB.
- "Clear all" empties the surface, breathing-dot quiet state returns.
- Trigger `signals-synthesize` once; confirm new duplicates collapse instead of stacking.
