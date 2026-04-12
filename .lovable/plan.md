

# Fix Persistent Chat History

## Problem
Chat messages appear to work in the current session but may not persist reliably across page refreshes or session switches. Two root causes:

1. **Missing UPDATE RLS policy on `chat_messages`**: The `finalizeMessage` function uses `upsert`, which requires UPDATE permission. The table only has INSERT, SELECT, and DELETE policies — no UPDATE. This means:
   - User messages: inserted by `saveMessage`, then the upsert in `finalizeMessage` silently fails on the update path (harmless since the row already exists with correct content)
   - Assistant messages: the upsert acts as an INSERT (works since the row doesn't exist yet), but if there's ever a conflict, it will fail silently

2. **Double-insertion of user messages**: `saveMessage` inserts the user message, then `finalizeMessage` tries to upsert the same ID. Without UPDATE permission, this second call fails silently. This is wasteful but not breaking — however it should be cleaned up.

## Plan

### 1. Add UPDATE RLS policy on `chat_messages`
Create a migration:
```sql
CREATE POLICY "Users can update own messages"
  ON public.chat_messages FOR UPDATE
  TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```
This ensures `upsert` works correctly for both user and assistant messages.

### 2. Fix the double-save in `src/pages/Index.tsx`
Currently `sendMessage` calls both `saveMessage(userMessage)` and `finalizeMessage(userMessage)` for the user message. Since `saveMessage` already inserts to DB and adds to local state, we should remove the redundant `finalizeMessage(userMessage)` call and instead just handle the session title update separately. Change:
- Remove `finalizeMessage(userMessage)` from the user message save path
- Keep `saveMessage(userMessage)` which does the insert + local state update
- Move the auto-title logic: after `saveMessage`, update the session title if it's the first user message

### 3. Verify with browser testing
After implementing, navigate to the app, send several messages, refresh the page, and confirm messages persist.

## Files changed
- **Migration SQL** — add UPDATE policy on `chat_messages`
- **`src/pages/Index.tsx`** — remove redundant `finalizeMessage(userMessage)` call
- **`src/hooks/useConversations.ts`** — ensure `saveMessage` handles auto-titling so `finalizeMessage` is only used for assistant messages after streaming

