

# Fix Chat UX, Multi-line Input, and Task Ticker Sync

## Problem 1: Chat pushes content upward
The hero section (title + subtitle) stays visible after messages begin, taking ~100px of vertical space and pushing messages up. The layout doesn't properly become a chat-focused view.

**Fix**: When `hasInteracted` is true, completely hide the hero section (title + subtitle) instead of shrinking it. This gives all vertical space to the message list.

## Problem 2: No multi-line input support
Both input fields are `<input type="text">` which cannot handle newlines. Shift+Enter and Ctrl+Enter do nothing.

**Fix**: Replace both `<input>` elements (pre-interaction and post-interaction) with auto-resizing `<textarea>` elements.
- **Enter** alone: submits the message
- **Shift+Enter** or **Ctrl+Enter**: inserts a newline
- Auto-resize up to ~6 lines, then scroll internally
- Keep the same rounded visual styling

## Problem 3: Task ticker says "failed" when AI succeeds
The root cause: when a tool call fails (e.g. `search_google_drive` returns 400), the backend emits `status: 'error'` for that step. The frontend `onTaskUpdate` handler calls `completeTask(taskId, 'error')`, marking the entire task as errored. But the AI recovers, tries a different approach, and eventually succeeds. The `onDone` handler then calls `completeTask` for all in-progress tasks, but this task was already marked as 'error' so it stays that way.

**Fix in `src/pages/Index.tsx`**:
- In `onTaskUpdate` for `status: 'error'`: only mark the **step** as error, do NOT mark the entire task as error. Individual tool step failures are normal — the AI retries.
- In `onDone`: mark ALL tasks (including errored ones) as 'done' since the AI completed successfully. Also set the summary from the final AI response.
- Only mark a task as 'error' when `onError` fires (meaning the entire chat stream failed).

## Files modified
- `src/pages/Index.tsx` — hide hero when chatting, convert inputs to textareas, fix task ticker logic

## What stays untouched
- All edge functions, stores, services, other components — zero changes
- Task activity store, bubble, portal — unchanged
- All existing functionality preserved (additive only)

