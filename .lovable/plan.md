

# Stability Pass: Concrete Issues and Fixes

## Issue 1: `finalizeMessage` does not update local messages state

**Root cause**: When `useChatStream` calls `persistAssistantMessage` for an already-existing message ID, it calls `finalizeMessage`. This function upserts to the DB but does NOT update the local `messages` array in `useConversations`. The reconciliation effect in `useChatStream` checks whether inflight messages exist in `persistedMessages` — but since `finalizeMessage` never updates local state with the final content, the reconciliation may fail or be delayed.

**Fix** (in `src/hooks/useConversations.ts`):
- In `finalizeMessage`, after the DB upsert, update local `messages` state with the finalized content. Add:
  ```typescript
  setMessages((prev) => {
    const exists = prev.some((m) => m.id === msg.id);
    if (exists) {
      return prev.map((m) => m.id === msg.id ? { ...m, content: msg.content } : m);
    }
    return [...prev, { ...msg, created_at: new Date().toISOString() }];
  });
  ```

## Issue 2: `saveMessage` has stale `messages` closure for auto-titling

**Root cause**: Both `saveMessage` and `finalizeMessage` depend on `messages` in their dependency array for the auto-title logic (`messages.filter(m => m.role === "user")`). But `messages` is state that changes during the same request cycle, creating stale closure bugs. The first user message check may fire incorrectly.

**Fix** (in `src/hooks/useConversations.ts`):
- Use a `messagesRef` to read current messages count for auto-title logic instead of the stale closure value. Add `const messagesRef = useRef(messages)` and keep it in sync, then read `messagesRef.current` inside `saveMessage` and `finalizeMessage`.

## Issue 3: No back navigation from Tasks and Studio pages

**Observation**: Both `/tasks` and `/studio` pages have headers but no way to navigate back to the home page. The `UserMenu` dropdown works but there's no home/back link in headers.

**Fix**: Not a stability issue — skip for now per the rules.

## Summary of changes

| File | Change |
|------|--------|
| `src/hooks/useConversations.ts` | `finalizeMessage`: update local messages state after upsert. Use `messagesRef` for auto-title checks in both `saveMessage` and `finalizeMessage` to avoid stale closures. |

This is two surgical fixes in one file, both addressing the same message handoff reliability problem.

