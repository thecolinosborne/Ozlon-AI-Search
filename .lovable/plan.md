

## Goal
Simplify The Brain page into one clean list of API keys with two states: **Connected** (validated, in use) and **Available** (waiting for a key). No duplicate cards, no usage breakdowns, no mode toggles cluttering the view. Higgsfield gets fixed so it actually shows up.

## What changes

### 1. Collapse The Brain into a single list
Replace the current `GauntletPanel` (header + banner + mode toggle + grid + usage + footer) with **one section**: a clean vertical list of all known providers, each row showing name, status dot, key tail (if connected), and a "Verify" mini-button.

```text
┌─ AI Brain ────────────────────────────── [Re-verify all] ─┐
│                                                            │
│  Connected (4)                                             │
│  ● OpenAI          ••••AbCd   verified 2m ago     [✓]     │
│  ● Gemini          ••••vaKQ   verified 2m ago     [✓]     │
│  ● Higgsfield      ••••XyZ1   verified 2m ago     [✓]     │
│  ● Lovable Gateway ••••wxyz   verified 2m ago     [✓]     │
│                                                            │
│  Available (1)                                             │
│  ○ Anthropic (Claude)   Add ANTHROPIC_API_KEY to enable   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

That's it. No second "stone" card grid, no usage % bar, no auto/manual toggle on this page (auto stays the default behind the scenes — `USE_GAUNTLET=1` is already on).

### 2. Fix Higgsfield not appearing
Root cause: `gauntlet-router/verify` only pings text-LLM providers; Higgsfield is an image/video API and gets skipped, so its row never gets a `keyTail` and the UI treats it as missing. Fix: in `gauntlet-router/index.ts`, add a Higgsfield branch that pings `GET https://platform.higgsfield.ai/...` (or just confirms `HIGGSFIELD_API_KEY` + `HIGGSFIELD_APP_ID` are both present and non-empty) and writes the row with `keyTail` from the api key. After that it shows up Connected.

### 3. Anthropic stays as an empty slot
Keep `anthropic` in the `ALL_STONES` array so it renders under "Available" with copy "Add ANTHROPIC_API_KEY to enable." The verify ping returns `{ ok: false, reason: "no key" }` cleanly — no red error, just a soft empty state.

### 4. "Synced keys integrate everywhere automatically"
This already works as of the last change (`USE_GAUNTLET=1` env-first routing in `_shared/model-registry.ts`). No new wiring needed — confirm with one log line in chat that the planner/executor is using the Gauntlet path. Add a tiny `[Gauntlet] using <provider>` console log on each call so it's visible in edge logs.

## Files touched (surgical, additive)

- `src/components/gauntlet/GauntletPanel.tsx` — replace contents with the simplified two-section list. Drop `AutoModeToggle`, `UsageBreakdown`, the keys-detected banner, and the "not yet supported" footer.
- `src/components/gauntlet/StoneSlot.tsx` — slim to a single row component (`ProviderRow`), no capability stat grid, no big card padding. Reused by both Connected and Available sections.
- `supabase/functions/gauntlet-router/index.ts` — add Higgsfield verify branch (checks both `HIGGSFIELD_API_KEY` and `HIGGSFIELD_APP_ID`, sets `keyTail` from api key, writes the row).
- `supabase/functions/_shared/model-registry.ts` — add a one-line `console.log("[Gauntlet] route ->", provider, model)` for visibility.

**Untouched:** `useGauntlet` hook, routing logic, all chat/orchestrator behavior, every other page.

## Verification

1. `/settings/brain` shows a single list. Connected: OpenAI, Gemini, Higgsfield, Lovable. Available: Anthropic with the "Add key" hint.
2. Higgsfield row shows `••••<last4>` and "verified just now."
3. Click "Re-verify all" → all four Connected rows refresh with new timestamps.
4. Edge logs show `[Gauntlet] route -> openai gpt-5` (or similar) on each chat turn — proving the keys are wired into the live AI path.
5. Drop an `ANTHROPIC_API_KEY` later → Anthropic moves from "Available" to "Connected" automatically on next verify, no UI change needed.

## Outcome
One clean page. One source of truth. Connected keys are visibly powering the AI; empty slots wait quietly. No duplicate cards, no decorative stats, no confusion about what's on or off.

