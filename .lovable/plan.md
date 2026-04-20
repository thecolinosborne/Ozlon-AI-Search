

## Goal
Make the keys you've already added (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `HIGGSFIELD_API_KEY`, `ANTHROPIC_API_KEY`) (a) **visibly confirmed** in The Brain, (b) **actually used** by chat/orchestrator instead of the Lovable gateway, and (c) **really invoked** for Higgsfield image/video generation.

## What's broken right now

| Symptom | Root cause |
|---|---|
| Gemini/OpenAI stones look "not plugged in" | The Brain page only renders rows that already exist in `ai_providers`. New users have an empty table → stones appear dim until "Verify all" is clicked. No first-load auto-verify. |
| Chat still goes through Lovable gateway | `chat/index.ts` uses `_shared/model-registry.ts` → `ai.gateway.lovable.dev`. It never calls `gauntlet-router`. Same for `summarize-session`, `personality-evolve`, `viral-creative`, `image-gen`, `video-gen`. |
| Higgsfield stone never actually generates | `callHiggsfield()` in `gauntlet-router/index.ts` is a stub that returns `[higgsfield] queued: …` text — it does not call the real `higgsfield` edge function. |
| Stone slot shows "System Stone · Powered by system key" but no last-verified or key-tail | UI lacks a "key detected ✓ ending in •••• 4f2a · last verified 2m ago" affordance. |

## The fix (surgical, additive)

### 1. Auto-verify on first load + key-tail confirmation
- `useGauntlet.refresh()` → if no `ai_providers` rows exist for the user, auto-run `verify` once before fetching list.
- `gauntlet-router /verify` → also returns `keyTail` (last 4 chars) per provider so the UI can show `✓ Key detected · ••••a4f2`.
- Persist `keyTail` into `ai_providers.capabilities.keyTail` (no schema change — it's jsonb).
- `StoneSlot.tsx` shows under the System Stone badge:
  > ✓ Key detected · ••••a4f2 · verified 2 min ago

### 2. Make Higgsfield stone actually generate
Replace the stub `callHiggsfield()` with a real dispatch:
- Detect modality from messages: if `image_gen` → call `higgsfield` edge fn `generate_image`; if `video_gen` → call `generate_video`.
- Forward the user's auth header so the existing per-user vault lookup in `higgsfield/index.ts` works (or fall back to `HIGGSFIELD_API_KEY` + `HIGGSFIELD_APP_ID` system secrets, which you already have set).
- Return a normalized shape: `{ choices: [{ message: { content: <url or job id> } }], model: "higgsfield" }`.

### 3. Route chat through the gauntlet (opt-in flag, default ON for you)
This is the meaningful "stop using Lovable" change. We add a thin shim **without** rewriting the chat function:
- New helper `supabase/functions/_shared/gauntlet-call.ts` — small wrapper that calls `gauntlet-router /call` with `{ needs, messages, tools }` and returns the same shape `model-registry.callWithFallback()` does today.
- In `_shared/model-registry.ts` → `callWithFallback()`, add a top-of-function check:
  ```ts
  if (Deno.env.get("USE_GAUNTLET") === "1" || prefs.use_gauntlet) {
    return gauntletCall({ agent, messages, tools, userId });
  }
  ```
- The gauntlet router decides per-call: vision → Gemini direct, heavy reasoning → OpenAI direct, fast/cheap → Lovable, image_gen → Lovable Gemini Nano or Higgsfield, video_gen → Higgsfield.
- Set `USE_GAUNTLET=1` as a project secret to flip it on globally.
- Add a per-user toggle in `user_model_preferences.use_gauntlet` (jsonb already exists) so individual users can disable it without redeploy.

### 4. Wire the other AI-calling functions
Same one-line shim added to:
- `summarize-session/index.ts`
- `personality-evolve/index.ts`
- `viral-creative/index.ts`
- `image-gen/index.ts` → new path: if gauntlet active, call `gauntlet-router` with `modality: "image_gen"` and let it pick Gemini direct vs. Higgsfield
- `video-gen/index.ts` → same with `modality: "video_gen"`

Lovable gateway becomes a **fallback stone**, not the primary path.

### 5. UI clarity tweaks on The Brain page
- Auto-trigger `verifyAll()` on first mount if `providers.length === 0`.
- Show a small banner above the stone grid:
  > "4 keys detected. Auto mode is picking the best one per task."
- Per-stone tooltip shows: capabilities active for routing (e.g. "Used for: vision, long context, fast text") so you can see *what each stone is doing*.

## Files touched

**Modified (additive, surgical):**
- `supabase/functions/gauntlet-router/index.ts` — real Higgsfield dispatch, return `keyTail` from verify
- `supabase/functions/_shared/model-registry.ts` — top-of-function gauntlet shim
- `supabase/functions/summarize-session/index.ts` — gauntlet shim
- `supabase/functions/personality-evolve/index.ts` — gauntlet shim
- `supabase/functions/viral-creative/index.ts` — gauntlet shim
- `supabase/functions/image-gen/index.ts` — route via gauntlet for image_gen
- `supabase/functions/video-gen/index.ts` — route via gauntlet for video_gen
- `src/hooks/useGauntlet.ts` — auto-verify on first load, expose `keyTail` per stone
- `src/components/gauntlet/StoneSlot.tsx` — show "✓ Key detected · ••••XXXX · verified Nm ago"
- `src/components/gauntlet/GauntletPanel.tsx` — top banner with "N keys detected"

**New:**
- `supabase/functions/_shared/gauntlet-call.ts` — single-purpose wrapper

**Untouched:** all 259 chat tools, voice, onboarding, auth, Higgsfield detail page (still works for advanced settings), every other integration.

## Secrets needed
None new. All four already configured:
- `OPENAI_API_KEY` ✓
- `GEMINI_API_KEY` ✓
- `ANTHROPIC_API_KEY` ✓
- `HIGGSFIELD_API_KEY` + `HIGGSFIELD_APP_ID` ✓

We will add **one new secret toggle**: `USE_GAUNTLET=1` (project secret, on/off switch so you can roll back instantly if anything regresses).

## Verification (run after deploy)
1. Open `/settings/brain` cold (no prior verify) → all 4 stones light up automatically with "✓ Key detected · ••••XXXX"
2. Send a chat message → check `gauntlet_routing_log` table → see `chosen_stone = openai` or `gemini` (not lovable) for normal text
3. Send a vision message (image attached) → `chosen_stone = gemini` (direct, not Lovable)
4. Run image generation in chat → `chosen_stone = lovable` or `higgsfield`, image appears
5. Trigger video generation → `chosen_stone = higgsfield`, real job ID returned (not stub text)
6. Disable OpenAI stone in UI → next chat falls back to Gemini direct, completes
7. Set `USE_GAUNTLET=0` → system reverts to Lovable gateway path, nothing breaks

## Outcome
Your direct provider keys become the *primary* execution path. Lovable gateway becomes a safety net. The Brain page visibly confirms each key is plugged in. Higgsfield actually generates. One env flag (`USE_GAUNTLET`) controls the whole switchover.

Approve and I execute.
