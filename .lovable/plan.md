

## Honest answer: No, the Routing Budget toggle is currently cosmetic.

The toggle saves your selection (Speed / Balanced / Quality) to `localStorage` and shows a toast — but the value never reaches the backend scorer. The router's `pickStone()` already reads `cost_sensitivity`, but no one passes it. So clicking Speed vs Quality changes nothing about which model gets chosen.

## What needs to happen (4 small changes)

### 1. Send the mode with every chat request
`useChatStream` / `chatService.ts` reads the mode from localStorage and includes it in the chat request body as `routing_mode: "speed" | "balanced" | "quality"`.

### 2. Forward it through chat → gauntlet
`supabase/functions/chat/index.ts` reads `routing_mode` from the request body and passes it into `gauntletCall(...)` as a new option.

### 3. Translate mode → scorer inputs
`_shared/gauntlet-call.ts` maps the mode into the two knobs the scorer already understands:
- **Speed** → `cost_sensitivity: "high"`, `latency_priority: "fast"` (cheapest capable stone wins)
- **Balanced** → `cost_sensitivity: "medium"`, keep classified latency (current behavior)
- **Quality** → `cost_sensitivity: "low"`, `latency_priority: "relaxed"` (best stone, cost ignored)

These overrides take precedence over the per-message classification so the user's budget choice is respected.

### 4. Apply the same path to image-gen and video-gen
`image-gen` and `video-gen` edge functions also call through `gauntletCall` — accept and forward `routing_mode` from their request bodies too, so the budget applies to all modalities, not just chat.

## Files touched
- `src/services/chatService.ts` (or wherever the chat invoke is built) — read `localStorage["ozlon.gauntlet.mode"]` and include in request body.
- `supabase/functions/_shared/gauntlet-call.ts` — accept `routing_mode`, map to `cost_sensitivity` + `latency_priority` overrides in `deriveNeeds`.
- `supabase/functions/chat/index.ts` — pass `routing_mode` from body into `gauntletCall`.
- `supabase/functions/image-gen/index.ts`, `supabase/functions/video-gen/index.ts` — same passthrough.

**Untouched:** `pickStone` scorer (already accepts these inputs), Brain page UI, every other surface.

## Verification
1. Send the same prompt 3 times, switching the toggle between calls. Check the **Recent routing decisions** panel:
   - **Speed** → flash/mini-tier stones win (gemini-2.5-flash, gpt-5-nano).
   - **Balanced** → mid-tier picks (current behavior).
   - **Quality** → pro-tier stones win (gpt-5, gemini-2.5-pro).
2. Each row's `reason` field reflects the budget (e.g., `"speed mode: cheapest capable"`).
3. Image-gen with Speed mode picks the cheaper image stone; with Quality, the best one.

## Outcome
The toggle becomes real: one knob that demonstrably changes which stone the router picks, provable in the audit log on the same page.

