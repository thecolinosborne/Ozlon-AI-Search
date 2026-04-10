

# Task Activity Portal + Email Management Tools

## Two Problems to Solve

### Problem 1: No email management tools
The chat edge function has `send_email` and `create_email_draft` but **no tools for reading, filtering, trashing, or managing emails**. When you asked Ozlon to clean your inbox, it had no tool to execute that action. It could only read a summary of unread emails via the fetcher — it cannot trash, delete, label, or batch-modify messages.

### Problem 2: No task visibility
When the AI does execute background operations, there's no feedback showing what it's doing. The approved Task Activity Portal plan addresses this.

## Implementation

### Part 1: Email Management Tools (chat edge function)

Add these tools to `supabase/functions/chat/index.ts`:

| Tool | Gmail API Endpoint | Purpose |
|------|-------------------|---------|
| `list_emails` | `GET /messages` with query params | Search/filter emails by query (from, subject, label, date) |
| `get_email` | `GET /messages/{id}` | Read full email content |
| `trash_email` | `POST /messages/{id}/trash` | Move single email to trash |
| `batch_trash_emails` | `POST /messages/batchModify` | Move multiple emails to trash at once |
| `label_email` | `POST /messages/{id}/modify` | Add/remove labels (INBOX, STARRED, etc.) |
| `mark_email_read` | `POST /messages/{id}/modify` | Mark as read (remove UNREAD label) |

The `batch_trash_emails` tool is critical — it allows the AI to fetch emails, identify non-client ones, and trash them in a single batch call instead of one-by-one (avoiding edge function timeouts).

Tool definitions go in `MATON_ACTION_TOOLS`, execution handlers in the `executeToolCall` switch block, and service mapping in `toolToService`.

### Part 2: Task Activity Portal (frontend)

**New files:**
1. `src/stores/useTaskActivityStore.ts` — Zustand store tracking `{ id, title, status, steps: { label, status, timestamp }[] }[]`
2. `src/components/TaskActivityBubble.tsx` — Fixed-position floating bubble (bottom-right, above bottom nav) with spinner, shows when tasks are active, click to expand
3. `src/components/TaskActivityPortal.tsx` — Sheet/drawer showing step-by-step progress with status icons (checkmark/spinner/circle)

**Modified files:**
1. `src/services/chatService.ts` — Parse `event: task_update` SSE events alongside existing `data:` events, add `onTaskUpdate` callback
2. `src/pages/Index.tsx` — Render `<TaskActivityBubble />`, wire `onTaskUpdate` from `streamChat` to task store
3. `supabase/functions/chat/index.ts` — Emit `event: task_update` SSE events before/after each tool execution:
   ```
   event: task_update
   data: {"taskId":"...","title":"Cleaning inbox","step":"Fetching emails","status":"in_progress"}
   ```

### Part 3: Backend task update emission

In the chat edge function's tool execution loop, before calling each tool:
- Emit an SSE `task_update` event with status `in_progress`
- After tool returns, emit another with status `done` or `error`
- This gives the frontend real-time step-by-step visibility

## Design
- Bubble: fixed bottom-right (above bottom nav), 48px, pulsing primary ring when active, green check when done
- Portal: Sheet sliding up, clean step list with `✓ ⏳ ○` indicators
- Auto-dismiss 5s after all steps complete

## Files Changed
- `supabase/functions/chat/index.ts` — Add 6 email tools + task_update SSE emission
- `src/services/chatService.ts` — Parse task_update events
- `src/pages/Index.tsx` — Render TaskActivityBubble, wire onTaskUpdate
- `src/stores/useTaskActivityStore.ts` — New
- `src/components/TaskActivityBubble.tsx` — New
- `src/components/TaskActivityPortal.tsx` — New

## What Stays
- All existing tools, fetchers, and integrations untouched
- No database changes
- No new edge functions (everything added to existing chat function)

