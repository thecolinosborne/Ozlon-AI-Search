

## Goal
Collapse the redundant "Your Brains" / "AI Brain" split on `/settings/brain` into one unified section.

## What's there now
The `/settings/brain` page renders two stacked panels covering the same providers:
1. A "Your Brains" header/intro section
2. The `GauntletPanel` ("AI Brain" with Connected / Available list)

Both describe the same set of API keys, which is the redundancy you're seeing.

## The change
Edit `src/pages/Settings.tsx` (the `/settings/brain` route). Remove the outer "Your Brains" wrapper header/intro block. Keep only the `GauntletPanel`, rendered directly inside the page's standard settings container.

Result: one section, one header ("AI Brain"), one Connected list, one Available list. Nothing else.

## Files touched
- `src/pages/Settings.tsx` — strip the duplicate "Your Brains" section wrapper around `<GauntletPanel />`.

**Untouched:** `GauntletPanel`, `StoneSlot`, `useGauntlet`, routing, every other settings page.

## Verification
1. Visit `/settings/brain` → see exactly one section titled "AI Brain" with Connected (OpenAI, Gemini, Higgsfield, Lovable) and Available (Anthropic).
2. No second header, no duplicate intro text, no second card grid above or below.
3. "Re-verify all" still works and refreshes timestamps.

