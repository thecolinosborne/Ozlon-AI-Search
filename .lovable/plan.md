

# Full Stability Scan: Chat Continuity, API Sync, and Reliability

## Issues Found

### 1. Chat gets stuck after a few messages (CRITICAL)
**File**: `src/services/chatService.ts` and `src/pages/Index.tsx`

`streamChat` has no `AbortController` or timeout. If the edge function hangs or the network drops, `reader.read()` blocks forever — `onDone` and `onError` never fire, so `isLoading` stays `true` permanently. Every subsequent send is blocked by `if (!text.trim() || isLoading) return;` on line 163.

Additionally, clicking "New Chat" while a stream is in-flight does not cancel the old stream. The old `onDone` callback later fires `finalizeMessage` → `ensureSession`, which can create a ghost session or write to the wrong one.

**Fix**:
- Add `signal?: AbortSignal` to `StreamChatOptions`
- Pass `signal` to the `fetch()` call
- In `Index.tsx`, store an `AbortController` ref; abort it on every new `sendMessage` and on `startNewChat`
- Add a 120-second safety timeout that force-resets `isLoading` if the stream hasn't completed

### 2. `createSession` wipes messages mid-flight (RACE CONDITION)
**File**: `src/hooks/useConversations.ts`, line 65

`createSession` calls `setMessages([])`. When `saveMessage` calls `ensureSession` → `createSession` after already adding the user message optimistically (line 125), this `setMessages([])` erases it. The user's message disappears.

**Fix**: Remove `setMessages([])` from `createSession`. Callers that need a clean slate (`startNewChat`, `init`) already clear messages before calling it.

### 3. Trash email handlers (ALREADY FIXED - verified)
The `trash_email` and `batch_trash_emails` handlers in `supabase/functions/chat/index.ts` (lines 1975-2020) are correctly wrapped in try/catch with per-ID error capture and structured failure responses. No changes needed.

### 4. SSE parser (ALREADY FIXED - verified)
The `catch` block in `chatService.ts` (lines 265-271) correctly re-buffers incomplete `data:` lines and continues processing without breaking. No changes needed.

## Implementation

### File 1: `src/services/chatService.ts`
- Add `signal?: AbortSignal` to `StreamChatOptions` interface
- Pass `signal` to the `fetch()` call on line 144

### File 2: `src/pages/Index.tsx`
- Add an `AbortController` ref (`abortRef`)
- In `sendMessage`: abort previous controller, create new one, pass `signal` to `streamChat`
- In `startNewChat` handler: abort current stream, force `setIsLoading(false)`
- Add 120-second safety timeout after `streamChat` starts; clear on completion

### File 3: `src/hooks/useConversations.ts`
- Remove `setMessages([])` on line 65 inside `createSession`

## Files Changed
- `src/services/chatService.ts` — add AbortSignal support
- `src/pages/Index.tsx` — abort management + safety timeout
- `src/hooks/useConversations.ts` — remove race-causing setMessages call

## No backend/edge function changes needed
Trash handlers and SSE parser are verified working correctly.

