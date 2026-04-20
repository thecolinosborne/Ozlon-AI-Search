

## Goal
Make Higgsfield (and any other system stone) resolve to Connected/Available within one page load instead of spinning forever.

## Root cause
1. **Backend**: `gauntlet-router` `list` action only auto-verifies stones that are *missing* from `ai_providers`. If a stale Higgsfield row exists with `status="error"` from an earlier failed attempt (before the verify branch was fixed), it never re-runs and stays broken.
2. **Frontend**: `StoneSlot` treats `verifying = !row` as a permanent state — if the row never arrives or arrives without `keyTail`, the loader spins indefinitely with no resolution.

## Fix (two surgical changes)

### 1. `supabase/functions/gauntlet-router/index.ts` — heal stale rows on `list`
Extend the auto-verify loop in the `list` branch: in addition to *missing* providers, also re-verify any existing row where:
- `status = "error"` AND the corresponding env key is now present, OR
- `capabilities.keyTail` is null/missing.

This self-heals Higgsfield's stale error row on the next page load. No schema changes, no migration.

### 2. `src/components/gauntlet/StoneSlot.tsx` — never spin forever
Change spinner logic so a row with `status="active"` always shows the green check, even if `capabilities.keyTail` happens to be null. Keep the spinner only for a brief in-flight `verifying` prop passed from the parent (during "Re-verify all"). If `row` is missing AND not actively verifying, render as Available with the soft empty state instead of an infinite loader.

### 3. `src/components/gauntlet/GauntletPanel.tsx` — pass real verifying state
Pass the `verifying` flag from `useGauntlet()` down to each `StoneSlot` so the spinner only appears during an actual in-flight verify, not as a default "no data yet" state.

## Files touched
- `supabase/functions/gauntlet-router/index.ts` — extend auto-verify in `list`
- `src/components/gauntlet/StoneSlot.tsx` — fix spinner logic, never infinite
- `src/components/gauntlet/GauntletPanel.tsx` — thread `verifying` prop through

**Untouched:** routing logic, BYOK section, every other page, the schema.

## Verification
1. Reload `/settings/brain`. Higgsfield resolves within ~2s to Connected with `••••<tail>` + "verified just now".
2. No row ever shows a stuck spinner — it's either Connected (green check), Error (red X), or Available (dashed empty slot).
3. Clicking "Re-verify all" briefly shows spinners on all rows, then resolves.
4. The Available section still shows Anthropic with "Add ANTHROPIC_API_KEY to enable."

