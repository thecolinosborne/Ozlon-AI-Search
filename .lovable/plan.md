## What's there today

You actually have **two** routing layers — and chat is using the dumber one.

**Layer 1 — Static failover chain (what chat uses now)**
`supabase/functions/chat/index.ts` → `chainFor(modelName)` + `callModelWithFallback`.
This is what we built last turn. It just walks: OpenAI direct → Lovable Gateway (GPT-5.4) → Lovable Gateway (GPT-5) → Gemini 3 Flash → Gemini 2.5 Flash. Order is fixed. No awareness of what the message actually needs.

**Layer 2 — Gauntlet Router (the real orchestrator, already built, not wired into chat)**
- `supabase/functions/gauntlet-router/index.ts` — scores models per request and picks the "best stone."
- `supabase/functions/_shared/gauntlet-call.ts` — classifies each message (modality, complexity, latency, cost, context size) and submits to the router.
- `supabase/functions/_shared/model-registry.ts` `callWithFallback()` — has a "GAUNTLET SHIM" that routes through the router by default.
- Already used by `signals-create`. **Not** used by the main `chat` tool loop.
- Honors a per-user budget mode (`speed | balanced | quality`) from the Brain page.

So the orchestrator exists, picks across OpenAI / Gemini / Anthropic / Higgsfield / Lovable, and logs to `gauntlet_routing_log`. The chat function just isn't asking it.

## Goal

Make the chat tool loop go through Gauntlet so the model is picked **per message** (Gemini for cheap/short, GPT-5.4 for hard reasoning, etc.), with the static failover chain as the safety net underneath.

## Plan

### 1. Route chat through Gauntlet first

In `supabase/functions/chat/index.ts`, both call sites (lines ~8197 and ~10048):
- Call `gauntletCall({ agent: "chat", messages, tools, tool_choice, routing_mode, authHeader })`.
- Pass the user's routing mode (already on `globalThis.__currentRoutingMode`, set on Brain page).
- On success → use that response. Emit `provider_used` SSE with `{ stone, model, fallback_used }` so the UI can show "served via Gemini 3 Flash via Gauntlet".
- On failure (router 5xx, no stones available, classification miss) → fall through to existing `callModelWithFallback(chainFor(modelName), …)`. No regression: the Phase 1 failover chain stays as the last line of defense.

### 2. Tool-calling parity check

Gauntlet already forwards `tools` and `tool_choice` (`gauntlet-call.ts` lines 132–140). Verify in `gauntlet-router/index.ts` that the chosen stone supports tools — if not, the router should either skip it or strip tools for chitchat. Add a `requires_tools: true` hint in the `needs` payload from chat so the router never picks a tools-incapable stone for a tool-loop turn.

### 3. Surface attribution to the UI

Reuse the existing `RoutingChip` component (`src/components/chat/RoutingChip.tsx`). Extend the `provider_used` SSE event payload to include:
```
{ stone, model, fallback_used, reason, mode }
```
Frontend (`useChatStream.ts`, `ChatService.ts`) already parses custom SSE events — just thread the new fields onto the message and render in the chip.

### 4. Logging & observability

`gauntletCall` already writes to `gauntlet_routing_log`. Add one log line in chat: `[chat] route → ${stone}/${model} via gauntlet (mode=${routingMode})` so edge logs make the routing decision obvious.

### 5. Verification

- Send a one-line greeting → expect router to pick a cheap Gemini Flash (low complexity / fast latency).
- Send a long technical reasoning prompt → expect GPT-5.4 or Gemini 2.5 Pro.
- Force `OPENAI_API_KEY=invalid` → router still serves via Lovable/Gemini stones; if router itself is down, Phase 1 chain takes over.
- Toggle Brain page mode to `speed` → confirm router picks cheaper stone for the same prompt.

## Out of scope

- No registry/scoring changes inside `gauntlet-router` — it already scores by capability + cost + latency.
- No new providers, no new secrets.
- No UI redesign — only the existing `RoutingChip` gets richer data.
- `personal_research`, embeddings, post-turn memory: same pattern can be applied later.

## Files touched

- `supabase/functions/chat/index.ts` — wrap both `callModelWithFallback` sites in a `gauntletCall` → fallback try/catch; emit richer `provider_used` SSE.
- `supabase/functions/_shared/gauntlet-call.ts` — pass `requires_tools` through to router.
- `supabase/functions/gauntlet-router/index.ts` — respect `requires_tools` when scoring stones.
- `src/hooks/useChatStream.ts` + `src/services/chatService.ts` — parse extended `provider_used` payload.
- `src/components/chat/RoutingChip.tsx` — render stone + model + mode.
