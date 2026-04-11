

# Fix: Enable Tools So Email Trash Actually Works

## Problem
When you ask "put those in trash," the chat sends `enableTools: false` (the default). The AI sees 83 available tools on the backend but the frontend never enables them, so the AI can only respond with text — it cannot execute `trash_email` or any other tool.

## Root Cause
In `src/pages/Index.tsx`, the `streamChat()` call does not include `enableTools: true`. The default in `chatService.ts` is `false`.

## Fix

### 1. Enable tools in the streamChat call (`src/pages/Index.tsx`)
Add `enableTools: true` to the `streamChat()` options object (around line 172). This tells the backend to include the tool definitions in the OpenAI request, allowing the AI to call `trash_email`, `send_email`, etc.

### 2. Add onToolCall handler
The `streamChat` call also needs an `onToolCall` callback. Since the backend already handles tool execution internally (the tool loop runs server-side and streams results back as content deltas), this handler can be minimal — just a log or no-op. The backend's tool execution results are already streamed back as content.

## Files Changed

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Add `enableTools: true` and `onToolCall` to `streamChat()` call |

## What This Fixes
- "Trash those emails" will actually execute the trash tool
- "Send an email to..." will actually send
- All 83 connected tools become usable from the chat

