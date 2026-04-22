

## Communications: full context, threads, smart replies, delete

Three additive fixes layered onto what's already shipped. No redesign — same hero/stream/sheet you like. Each fix is independently revertable.

---

### Fix 1 — Full message context in the Reply Sheet

**Problem:** the sheet shows only the 240-char `snippet` from the aggregator. You can't actually read the email/Slack message.

**New edge function:** `supabase/functions/communications-thread/index.ts`
- Input: `{ source: "gmail" | "slack" | "ghl", threadId, messageId? }`
- Returns a normalized array `{ messages: ThreadMessage[] }` where each `ThreadMessage` has `{ id, fromName, fromHandle, direction: "in" | "out", body, sentAt, attachments?: [...] }`.
- Per source:
  - **gmail** → calls existing `google-gmail` `get_thread` (`format=full`), walks `payload.parts` to extract `text/plain` (fallback `text/html` stripped to text), pulls attachment metadata (filename, mime, size, attachmentId).
  - **slack** → calls `conversations.replies` via the slack gateway with the channel + thread_ts already on the message id (`slack:<channel>:<ts>`). Resolves user IDs to display names with a small `users.info` cache.
  - **ghl** → calls existing `gohighlevel` `get_conversation_messages`, normalizes `direction` from GHL's `direction` field.
- Best-effort: errors return `{ messages: [], error: "..." }` so the sheet never blanks.

**Frontend:** `ReplySheet.tsx`
- Add `useQuery(["thread", message.id])` that fires when the sheet opens, calls `communications-thread`.
- Replace the single grey preview card with a vertical thread: each message is a small bubble — incoming (left, neutral) vs outgoing (right, primary tint). Newest at the bottom, auto-scrolled into view.
- Loading state: 3 skeleton bubbles.
- The AI draft block stays exactly where it is, below the thread.
- AI draft prompt now receives the **last 3 messages** in the thread as context, not just the snippet — so replies finally reference the actual conversation.

---

### Fix 2 — Conversation-aware AI replies

**Update:** `supabase/functions/communications-draft/index.ts`
- New optional input field: `threadContext?: Array<{ from: string; body: string; direction: "in" | "out" }>` (last 3 messages, oldest → newest).
- System prompt addition: *"You're continuing an ongoing thread. Match the conversational tone already established. Reference specifics from the prior messages when natural."*
- User content now includes the thread block above the message-to-reply-to.
- Falls back to current single-message behavior if `threadContext` not provided (zero regression).

**Frontend wiring:** `ReplySheet.tsx`
- Pass `threadContext` from the loaded thread query into every `generate()` call (initial draft + tone regenerations).

---

### Fix 3 — Delete / archive action

**Backend:** all three providers already support deletion — no new edge function needed.
- **gmail** → existing `trash_message` action on `google-gmail`.
- **slack** → already supports `chat.delete` via gateway; add a `slack-delete-message` thin call (5 lines, gateway pass-through). Will only succeed for messages the user posted — gracefully report "Slack only allows deleting your own messages" otherwise.
- **ghl** → no message-level delete in their API. Show "Mark as read" instead, which calls existing `update_conversation` with `read: true`.

**Frontend:** `ReplySheet.tsx` footer
- Add a third ghost icon button between Mic and Send: `Trash2` icon.
- Click → confirm pill ("Delete this message?") → call the right handler based on `message.source`.
- On success: close sheet, optimistically remove from `stream` (matches existing snooze/done pattern), toast "Deleted" with an Undo (Undo only available for Gmail — calls `untrash_message`).

**Frontend:** `MessageRow.tsx` hover actions
- Add a third hover button next to Done/Later: `Trash` (red-tinted on hover only). Same handler. Mobile gets it via long-press → action sheet (out of scope this round, hover desktop only).

---

### Out of scope (explicitly not touching)

- The hero digest, channel chips, triage mode, filter dropdown — all stays.
- No schema changes, no new tables, no RLS edits.
- Gmail signature/threading on **send** — Send button still doesn't post (separate follow-up).
- Mobile swipe-to-delete gestures.
- Bulk delete / multi-select.

### Order of operations

1. Fix 1 (thread fetch + bubbles) — biggest visible win, fully isolated.
2. Fix 2 (context-aware drafts) — 15-line edge function diff + 1-line frontend pass.
3. Fix 3 (delete) — additive, gated by source.

### Verification

- Tap any Gmail message → see full body + any prior replies as bubbles, not the snippet.
- Tap a Slack thread mention → see the reply chain expanded.
- Open an email reply in a 3-msg thread → AI draft references what was said earlier.
- Click trash on a Gmail message → confirm → row disappears, undo toast restores it.
- Click trash on a Slack message you didn't post → friendly error toast.

