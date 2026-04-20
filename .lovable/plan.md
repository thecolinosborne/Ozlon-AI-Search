

## What's actually happening today (the honest picture)

The Brain page is **not** purely cosmetic — the routing wiring is real:

- `USE_GAUNTLET=1` is set as a project secret → `callWithFallback` (used by chat) detects it and routes through `gauntlet-router` instead of going straight to Lovable Gateway.
- `gauntlet-router` calls `pickStone()` which scores every active provider on a 6-factor model: modality, reasoning need, vision need, image/video capability, speed, cost, and context size. Highest score wins, others become the fallback chain.
- `image-gen` and `video-gen` edge functions also check `USE_GAUNTLET` and route through the same path.
- Every selection writes to `gauntlet_routing_log` with `chosen_stone`, `reason`, `fallback_used`, `latency_ms`, and `key_source` (user vs system). This table is real and queryable.

So when you removed your OpenAI key, chat *will* fall back to Gemini or Lovable. That part works.

## The two reasons it FEELS cosmetic

**1. The "needs" sent into the scorer are hardcoded per agent, not per message.**
In `_shared/gauntlet-call.ts`, every `executor` call sends `{modality: "text", complexity: "high", latency_priority: "normal"}` no matter what the user asked. So the router always picks the same stone for chat. The scoring engine is real but the inputs are dumb — it's like having a sommelier who only ever gets told "wine."

**2. There's no UI proof of routing.**
The Brain page shows which keys are connected, but nowhere does the user see "this answer came from Gemini because OpenAI was rate-limited" or "we routed your image request to Higgsfield." The decision is invisible, so it looks fake.

## Plan: make routing real AND visible (4 surgical changes)

### Change 1 — Classify the message before routing (the actual brain)
Add a tiny pre-router in `_shared/gauntlet-call.ts` that derives `needs` from the **last user message**, not just the agent name:

- **Modality**: if the message has image attachments → `vision`; if it asks to "generate/create/draw an image" → `image_gen`; if "video" → `video_gen`; otherwise `text`.
- **Complexity**: cheap heuristics — message length > 500 chars OR contains code blocks OR contains words like "analyze/debug/refactor/explain why/architect" → `high`; short factual question → `low`; everything else → `medium`.
- **Latency priority**: voice mode or short message → `fast`; long-form ask → `relaxed`; default → `normal`.
- **Context size**: pass `messages` total char count / 4 as a token estimate so `pickStone` can disqualify small-context stones when conversation gets long.

This is ~40 lines of code, no new dependencies. It turns the scorer from theatre into a real decision.

### Change 2 — Surface the routing decision in the chat UI
The chat function already emits a `provider_used` SSE event (see `chatService.ts` → `ProviderUsedEvent`). Right now it shows nothing or is shown weakly. Wire it to render a small attribution chip under each assistant message:

> `Answered by Gemini 2.5 Pro · your key · 1.2s`

Click the chip → small popover shows the routing reason (`"gemini: vision 10/10, fast"`) and any fallback that was used. Pulled straight from the existing `gauntlet_routing_log` row via a lightweight `select` keyed on `run_id`. No new tables.

### Change 3 — Add a "Why this stone?" panel on the Brain page
Below the existing list of stones, add a collapsed section: **Recent routing decisions**. Reads the last 20 rows from `gauntlet_routing_log` and shows:

```
2m ago  · vision · gemini-2.5-flash · "vision 10/10, fast"     · 1.1s
5m ago  · text   · openai gpt-5     · "heavy reasoning"        · 2.3s · ↻ fell back from anthropic
```

This is the proof. Now the user can SEE the routing happening on every turn.

### Change 4 — Fix one real bug found during the sweep
`pickStone` scores `lovable` highly for image (`image: 9`) and video (`video: 7`), but `callLovable` only does chat completions — it has no image/video output path. So if Lovable wins for `image_gen`, the call will fail and fall back. Drop `lovable.image` and `lovable.video` to `0` in the STONES matrix so the scorer doesn't waste a turn on a guaranteed failure.

## Recommendations to make this better without overcomplicating it

Three additions, all small:

1. **Per-stone health budget** — track rolling 24h success rate per stone in a tiny in-memory cache (or a `gauntlet_health` view over the existing log). If a stone's success rate drops below 80%, automatically deprioritize it for ~15 minutes. Self-healing without manual intervention.

2. **One-click "Speed / Balanced / Quality" toggle on the Brain page** — three radio buttons that set the user's `cost_sensitivity` preference (`high` / `medium` / `low`). The scorer already accepts this input; we just need to surface it. Most users don't want to micromanage; they want one knob.

3. **Don't add per-message model picker UI** — resist the temptation. The whole point of the router is the user shouldn't think about it. Keep the choice automatic; expose only the *result* (the chip) and the *budget* (the toggle).

## Files touched

- `supabase/functions/_shared/gauntlet-call.ts` — classify message → needs (Change 1).
- `supabase/functions/gauntlet-router/index.ts` — fix Lovable image/video scores (Change 4); add `/recent_decisions` action for the Brain panel (Change 3).
- `supabase/functions/chat/index.ts` — pass `run_id` through so the chip can look up the routing log row (Change 2 plumbing).
- `src/components/chat/MessageBubble.tsx` — add the attribution chip (Change 2).
- `src/components/gauntlet/GauntletPanel.tsx` — add "Recent decisions" collapsed panel + Speed/Balanced/Quality toggle (Changes 3 + recommendation 2).
- `src/hooks/useGauntlet.ts` — fetch recent decisions; expose mode preference.

**Untouched:** Stone slot UI, BYOK plumbing, every other settings page, all 30+ integration edge functions, schema.

## Verification

1. Send "what's 2+2?" → chip shows a flash-tier model (low complexity won). Send "refactor this 800-line component" with a code paste → chip shows a pro-tier model (high complexity won). Different inputs route to different stones — provable.
2. Attach an image and ask "what's in this?" → chip shows Gemini (vision 10/10 wins).
3. Ask "generate an image of a sunset" → chip shows Gemini or Higgsfield, never Lovable (Change 4).
4. Open Brain page → "Recent decisions" shows the last 20 routes with reasons. Switch to "Speed" mode → next chat turn picks the cheapest capable stone; chip reflects it.
5. Kill the personal OpenAI key → next reasoning-heavy turn falls back, chip shows `↻ fell back from openai → gemini`. Visible proof, not just a backend log.

## Outcome
The router goes from "theoretically smart but always picks the same thing" to actually adapting per message. The user sees every decision in the chat itself and can audit the last 20 on the Brain page. One Speed/Balanced/Quality toggle covers 90% of preference needs without exposing model-picker UI.

