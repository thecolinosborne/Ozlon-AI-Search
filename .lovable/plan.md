
# Phase 1.5 — Fix chat session persistence + isolation

## The bug
When a user signs out and signs back in, all their old chats from prior sessions show up as one big merged thread instead of as discrete past conversations. Sessions aren't being properly created/separated, so context bleeds between what should be independent chats.

## Root causes (from reading `useConversations.ts` + `chat/index.ts`)
1. **Sign-in always reopens the most recent session** instead of starting fresh. Every login resumes the last thread, so new conversation intent gets glued onto old context.
2. **No "session ended" boundary.** Sign-out doesn't mark the active session as closed — next login picks it up mid-stream.
3. **Auto-title only fires on the very first user message.** Restored sessions whose title is still "New conversation" never get retitled, so the sidebar fills with identical-looking entries.
4. **Identity layer pulls last 3 conversation summaries**, but `chat_sessions.summary` is never written (Phase 2 piece). Today this just means no continuity. After the fix below, summaries will write on session close so Phase 2 becomes a one-line addition.
5. **Empty sessions accumulate.** `init` auto-creates a session every login if zero exist, but doesn't garbage-collect empty ones.

## Fix (Phase 1.5 — surgical, no UI redesign)

### 1. Sign-in opens a fresh session, not the last one
In `useConversations.ts` `init`:
- Load all sessions for sidebar (unchanged).
- **Do NOT auto-select the most recent session.** Set `activeSessionId = null`, `messages = []`.
- Hero/empty state shows. User explicitly clicks a past session OR types → new session created on first message (existing `ensureSession` path already handles this).

### 2. Sign-out closes the active session cleanly
In `AuthContext` sign-out flow (or a new effect in `useConversations`):
- Before clearing state, if active session has ≥2 messages and no summary, fire-and-forget call to a new `summarize-session` edge function (writes 2-3 sentence summary to `chat_sessions.summary`).
- If active session has 0 messages, delete it (garbage collect empty shell).

### 3. Garbage-collect empty sessions on init
In `init`, after loading sessions:
- Filter out any session with `title = 'New conversation'` AND no messages (cheap count query, batched).
- Delete them server-side. Prevents sidebar pollution from prior aborted logins.

### 4. Auto-title fires on session close too
When a session gets summarized (above), if title is still `"New conversation"`, set title from the summary's first ~50 chars. Past sessions become identifiable in the sidebar.

### 5. Identity layer reads summaries from OTHER sessions, not the active one
In `chat/index.ts` `buildIdentityPrompt`:
- Pull `summary` from the 3 most recent `chat_sessions` WHERE `id != current_session_id` AND `summary IS NOT NULL`.
- This is the continuity hook — new chat opens, model already knows "last week you discussed X, Y, Z" without dragging the literal old messages into context.

### 6. New edge function `summarize-session`
- Input: `session_id`, called with user JWT
- Loads last 30 messages of that session
- One Gemini Flash call → 2-3 sentence summary
- Writes to `chat_sessions.summary`; if title is still default, writes a short title too
- No JWT verification disabled — runs as the user (RLS protects writes)

## Files touched
- **Edit**: `src/hooks/useConversations.ts` — don't auto-select last session on init; GC empty sessions; expose `closeActiveSession()` helper
- **Edit**: `src/contexts/AuthContext.tsx` — call `closeActiveSession()` before clearing state on sign-out
- **Edit**: `supabase/functions/chat/index.ts` — `buildIdentityPrompt` excludes current session when pulling summaries
- **New**: `supabase/functions/summarize-session/index.ts`
- **No migration needed** — `chat_sessions.summary` already exists from Phase 1

## Verification
1. Sign in → see sidebar of past sessions, but main view is empty hero (no auto-loaded chat).
2. Type a message → new session created, titled from first message.
3. Sign out → active session gets summary written; empty sessions deleted.
4. Sign back in → empty hero again, sidebar shows yesterday's chat with a real title.
5. Start a new chat → model references "earlier you talked about X" from prior session summaries without showing the old messages.
6. Click a past session in sidebar → loads cleanly, no bleed.

After this ships, Phase 2 (heartbeat + auto-memory + conversation summarizer on idle) is mostly done — only the cron + idle-trigger pieces remain.
