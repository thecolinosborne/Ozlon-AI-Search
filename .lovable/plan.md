

# Harden useChatStream — Robust Async Lifecycle

## Problems in current code

1. **Loading state fragility** — `setIsLoading(false)` is called in 4 separate places (onDone, onError, catch, timeout). If `streamChat` resolves without calling onDone/onError (edge case), loading stays stuck.
2. **Blanket task completion** — `onDone` completes ALL in-progress/error tasks globally, not just ones from the current request. A prior request's errored task gets silently converted to "done".
3. **No error classification** — abort, timeout, network failure, and model error all get the same generic handling.
4. **Safety timeout doesn't finalize** — if timeout fires and content exists, it's not persisted to DB.
5. **Cleanup duplication** — timeout clearing is copy-pasted in 4 places.

## Solution

Rewrite `useChatStream.ts` with these structural changes:

### A. Request-scoped task tracking
- Track task IDs created during the current request in a `Set<string>` scoped to `sendMessage`.
- On completion, only complete tasks in that set.
- On error, only mark tasks in that set as errored — never convert errored tasks to done.

### B. Single cleanup path via `finally`
- Use a `finally` block after the `try/catch` to guarantee `setIsLoading(false)` and timeout cleanup, removing the 4 duplicated cleanup sites.
- Track request outcome with a local `outcome` variable: `'success' | 'aborted' | 'timeout' | 'error'`.

### C. Timeout as abort
- Instead of the timeout just setting loading to false, have it set the outcome to `'timeout'` and call `abort()` on the controller. This terminates the stream cleanly and flows through the single cleanup path.
- The catch block detects timeout via a flag on the abort reason.

### D. Finalization guarantee
- Move finalization (persist + autoplay) into the `finally` block, gated on `outcome === 'success' && assistantContent`. This ensures it runs even if `onDone` fires but the promise resolves before the callback completes.

### E. Clearer error messages
- Abort: no error message shown (intentional user action)
- Timeout: "Response timed out. Please try again."
- Network/service error: "Something went wrong. Please try again."

## Files

| File | Action |
|------|--------|
| `src/hooks/useChatStream.ts` | **Rewrite** |

No other files change. `chatService.ts`, `useTaskActivityStore.ts`, `Index.tsx` — all untouched.

## Key code structure

```typescript
const sendMessage = useCallback(async (text: string, intent?: string) => {
  // ... setup, user message, placeholder ...
  
  const requestTaskIds = new Set<string>();
  let outcome: 'success' | 'aborted' | 'timeout' | 'error' = 'error';
  let timedOut = false;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    abortRef.current?.abort('timeout');
  }, 120_000);

  try {
    await streamChat({
      // ...
      onTaskUpdate: (update) => {
        requestTaskIds.add(update.taskId);
        // ... existing step tracking ...
      },
      onDelta: (delta) => { /* same */ },
      onDone: () => { outcome = 'success'; },
      onError: (msg) => { outcome = 'error'; errorDetail = msg; },
    });
    // If streamChat resolves without onDone (reader exhausted), treat as success
    if (outcome !== 'error') outcome = 'success';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      outcome = timedOut ? 'timeout' : 'aborted';
    }
  } finally {
    clearTimeout(timeoutId);
    setIsLoading(false);
    
    if (outcome === 'success' && assistantContent) {
      finalizeMessage({ id: assistantId, role: 'assistant', content: assistantContent });
      requestTaskIds.forEach(id => completeTask(id, 'done'));
      if (autoPlayEnabled) playMessage(assistantId, assistantContent);
    } else if (outcome === 'timeout') {
      updateMessageContent(assistantId, assistantContent || 'Response timed out. Please try again.');
      requestTaskIds.forEach(id => completeTask(id, 'error'));
    } else if (outcome === 'error') {
      updateMessageContent(assistantId, 'Something went wrong. Please try again.');
      requestTaskIds.forEach(id => completeTask(id, 'error'));
    }
    // 'aborted' — no error message, no task mutation (user cancelled)
  }
}, [/* deps */]);
```

