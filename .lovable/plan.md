## Goal
Add a Copy button under user prompt bubbles (mirroring the assistant copy action) so users can grab their own prompts/paragraphs in one click instead of long-pressing or text-selecting.

## Scope
Frontend only — `src/components/chat/ChatMessageList.tsx`.

## Changes
1. In the message map, the existing `CopyAction` is only rendered under `role === "assistant"` rows. Add a parallel block for `role === "user"`:
   - Render a single `CopyAction` under the user bubble.
   - Align right (since user bubbles align right via `items-end`).
   - Keep the same styling/spacing (`mt-1.5 flex items-center gap-0.5 -mr-1`) so it visually matches the assistant toolbar.
2. No regenerate or speak buttons under user messages — copy only, per request.
3. Keep all assistant toolbar behavior unchanged.

## Out of scope
- ThreadView (separate surface).
- Touch/swipe gestures, long-press menus.
- Any backend, persistence, or message model changes.

## Verification
- Send a prompt → copy icon appears under the user bubble, right-aligned.
- Click copy → icon flips to check for ~1.5s, clipboard contains the prompt text.
- Assistant copy/speak/regenerate row continues to work as today.