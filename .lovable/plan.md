

# Fix: Conversation Sessions Not Persisting

## Problems Found

**Testing results:**
- Sent a message — AI responded, but the **user message bubble was not visible** in the chat
- Opened the sidebar — shows "No conversations yet" despite having an active chat
- Database has **zero rows** in both `chat_sessions` and `chat_messages` — nothing is being persisted

## Root Cause

The `useConversations` hook has a race condition in its initialization:

1. On mount, `loadSessions()` fires with `user = null` → immediately sets `sessionsLoaded = true`
2. When `user` becomes available, the auto-create effect sees `sessionsLoaded = true` and `!activeSessionId` → calls `createSession()`
3. But `createSession` may execute before the Supabase client has fully propagated the auth token to subsequent requests, causing the INSERT to fail silently (RLS rejects because `auth.uid()` is null in the request context)
4. Since messages depend on `activeSessionId` being set (which requires a successful `createSession`), `saveMessage` also silently does nothing

Additionally, even if `createSession` did work, the user message might not appear because `saveMessage` adds to local state but could be racing with the assistant placeholder being added.

## Fix Plan

### 1. Fix session initialization timing (`src/hooks/useConversations.ts`)
- Don't set `sessionsLoaded = true` when `user` is null — keep it false until we actually query with a real user
- Add error logging to `loadSessions` if the query fails
- Add a small guard in `createSession` to verify the session was actually created
- Ensure `saveMessage` and `finalizeMessage` handle the case where `activeSessionId` is null by auto-creating a session first

### 2. Fix the auto-create race condition
- Instead of two separate effects (load + auto-create), combine into one sequential flow:
  1. When `user` changes, load sessions
  2. After sessions load, if none exist or none are active, create one
  3. Only then set `sessionsLoaded = true`

### 3. Add console logging for debugging
- Log when `loadSessions` runs and what it returns
- Log when `createSession` runs and whether it succeeds or fails
- Log when `saveMessage` is called and whether `activeSessionId` is set

### 4. Ensure user messages display correctly
- Verify the `saveMessage` → local state update path isn't conflicting with the `setSessionMessages` call for the assistant placeholder

## Files Changed

| File | Change |
|------|--------|
| `src/hooks/useConversations.ts` | Fix initialization race condition, add logging, ensure sessions are created before messages are saved |

## Technical Details

```text
Current broken flow:
  mount → loadSessions(null) → sessionsLoaded=true
  user arrives → createSession() [may fail silently]
  user sends message → saveMessage() [activeSessionId may be null → no-op]

Fixed flow:
  mount → sessionsLoaded stays false
  user arrives → loadSessions(user) → sessions loaded
  → if no active session → createSession() → activeSessionId set
  → sessionsLoaded=true
  user sends message → saveMessage() [activeSessionId guaranteed set]
```

## Result
- Sessions will persist to the database reliably
- Messages will be saved per-session
- Sidebar will show conversation history
- Switching between conversations will work
- User message bubbles will appear in the chat

