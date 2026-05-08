## Goal
Add a small action row under every assistant message in the main chat (matching ChatGPT): **Copy**, **Speak / Stop** (already present, restyled into the row), and **Regenerate** (re-run the prompt that produced the message).

## Scope
Frontend / presentation only. No backend, schema, or routing changes.

## Files

1. **`src/components/chat/ChatMessageList.tsx`** — the live one used by `Index.tsx`.
   - Replace the standalone play button (lines 189–209) with a horizontal action toolbar that appears under finished assistant messages (`message.role === "assistant" && message.content` and not still streaming).
   - Toolbar buttons:
     - **Copy** — `navigator.clipboard.writeText(message.content)`. Show `Copy` icon → `Check` for ~1.5s on success.
     - **Speak / Stop** — keep existing `playMessage` wiring; same loading + active states, just restyled to match the row (small, ghost-style, muted-foreground).
     - **Regenerate** — `RotateCcw` icon. Disabled while `isLoading` (new prop). Calls a new `onRegenerate(message.id)` prop.
   - Buttons use semantic tokens (`text-muted-foreground hover:text-foreground hover:bg-muted/60`, rounded, ~28px). No raw color classes.
   - Toolbar sits under the bubble, left-aligned, with `mt-1.5` and `gap-1`.

2. **`src/pages/Index.tsx`** — wire `onRegenerate` and `isLoading` into `<ChatMessageList />`.
   - Implement `handleRegenerate(messageId)`:
     1. Find the assistant message in `renderedMessages` by id.
     2. Walk backwards to the most recent `role === "user"` message before it.
     3. If found and not currently loading, call `sendMessage(userMessage.content)` (same call used by the composer). The new assistant turn appends — we do not delete the prior turn (matches ChatGPT-on-mobile behavior and avoids touching persistence/edge code).
   - Pass `onRegenerate={handleRegenerate}` and `isLoading={isLoading}` props.

## Out of scope
- No edits to `MessageBubble.tsx` (not used by the live chat) or `ThreadView.tsx` — can be a follow-up if desired.
- No deletion / replacement of the prior assistant turn on regenerate (would require new edge-function logic). Easy to add later.
- No changes to TTS pipeline, copy permissions handling beyond the standard try/catch.

## Verification
- Hover an assistant message → three icons visible (copy, speaker, regenerate).
- Click copy → checkmark flashes, clipboard contains markdown text.
- Click speaker → existing TTS plays/stops as today.
- Click regenerate → re-sends the prior user prompt; new assistant bubble streams in. Disabled mid-stream.
- Visual tokens only — no hex/named colors introduced.
