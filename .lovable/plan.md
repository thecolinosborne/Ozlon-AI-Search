
User wants to verify the end-to-end flow: paste API key on Brain page → key gets stored → that platform's models become part of the Infinity Router's selection pool → router actually picks them when appropriate.

This is a **testing/verification task**, not new build. I should plan a verification pass and surface gaps if any. Let me check what's actually wired up.

Key questions:
1. Does `connect-brain` actually persist keys correctly?
2. Does the chat function's `mergeRegistry` pick up custom_models rows?
3. Does the router actually consider them when scoring?
4. Is there visible feedback the user can see?

User has zero custom_models right now (network logs confirm: `custom_models` returns `[]`). So nothing to test against — they need to plug a key first.

Plan: verification protocol + lightweight observability so the user can SEE routing decisions.

# Plan — Verify Brain key → Router integration

## Phase 1: Inspect current wiring (read-only)
Confirm three links in the chain:
1. `connect-brain` insert path → `custom_models` row with `inline:<key>` and platform_id
2. `chat` function `mergeRegistry()` reads custom_models and adds them to selection pool
3. Router scoring actually considers user-keyed models (not just baseline)

Files to inspect: `supabase/functions/connect-brain/index.ts`, `supabase/functions/chat/index.ts`, `supabase/functions/_shared/model-registry.ts`

## Phase 2: Live end-to-end test
1. User plugs in their Gemini key on `/settings/routing`
2. Verify a `custom_models` row appears (query DB)
3. Send a chat message that should route to Gemini (e.g. "describe this image" or "summarize this long doc")
4. Check `model_routing_log` to confirm the user's `inline:` key was used vs Lovable AI baseline
5. Disconnect → verify rows removed → verify router falls back

## Phase 3: Add visible "which brain handled this" indicator
Right now the user has no way to SEE which brain answered. Without this, "did it route correctly?" is invisible. Add minimal observability:
- Tiny footer line under each assistant message: "via Gemini (your key)" or "via Gemini (Ozlon)"
- Sourced from a new `provider_used` field already partially logged in `model_routing_log`
- Surface it through the existing SSE stream as a final metadata event

Files touched (Phase 3 only):
- `supabase/functions/chat/index.ts` — emit `event: provider_used` SSE before [DONE]
- `src/services/chatService.ts` — parse new event into `onProviderUsed` callback
- `src/hooks/useChatStream.ts` — store per-message provider info
- `src/components/chat/MessageBubble.tsx` — render small grey footer line

## Phase 4: Document the verification
Add a short section to memory describing how to validate Brain plug-in works, so future tests are repeatable.

## Safety
- Phases 1-2 are pure inspection/testing, no code changes
- Phase 3 is additive (one new SSE event, one new UI line) — doesn't touch routing logic
- Disconnecting any key reverts to baseline automatically (already wired)

## Effort
- Phases 1-2: 5 min inspection + live test
- Phase 3: 15 min
- Phase 4: 2 min
