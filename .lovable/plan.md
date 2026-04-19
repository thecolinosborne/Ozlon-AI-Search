
User confirms the model: tasks ARE chat threads, just a different view. Add: clicking Done soft-deletes the thread (trash for 30 days, auto-purge), and any chat session can be viewed as a task / any task as a chat — fully bidirectional.

## Plan

### 1. Simplify task statuses (3 states)
- `useWorkTasks.ts`: `STATUS_ORDER = ['todo', 'in_progress', 'done']`, drop `up_for_review` / `awaiting_user` from labels.
- `execute-task/index.ts`: stop writing `up_for_review`; leave at `in_progress` after each AI turn.
- Migration (data backfill via insert tool): map `up_for_review` + `awaiting_user` → `in_progress`; map thread `task_status='awaiting_user'` → `working`.

### 2. Task detail = thread only
`src/components/tasks/TaskDetail.tsx`
- Remove `Tabs`. Layout: header (title + status pill + priority + Mark done + archive) → `ThreadView` fills the rest.
- Move Status / Priority / Description into a small collapsible "Details" disclosure under the header.
- Remove "Run AI on this thread" button (every user message auto-runs AI).
- Remove "Notes", "AI draft", "Up for review" labels everywhere.

### 3. Mark Done → soft-delete with 30-day trash
- Schema migration: add `deleted_at timestamptz` to both `chat_sessions` and `work_tasks`.
- "Mark done" sets `status='done'` AND `deleted_at = now()` on both the work_task and its linked chat_session (single bidirectional action).
- All list queries (`useWorkTasks`, `useConversations`) filter `deleted_at IS NULL` by default.
- New "Trash" view (small link in Tasks sidebar + Chat sidebar) showing items where `deleted_at IS NOT NULL`. Actions: Restore (clears `deleted_at`) or Delete now.
- Auto-purge: scheduled cron (daily) deletes anything where `deleted_at < now() - 30 days` (cascades messages + artifacts via existing `conversation_id` filter).

### 4. Bidirectional chat ↔ task sync
The unified-thread model already shares `chat_messages` + `chat_sessions`. Tighten the bridge:
- **Chat → Task**: every chat session can be promoted. Add "Save as task" action in chat header → sets `kind='both'`, `goal=title`, `task_status='working'`, creates linked `work_tasks` row. Now appears in `/tasks`.
- **Task → Chat**: every task already has a `chat_sessions` row. Add "Open in chat" button in task header → navigates to `/?session=<id>`. Chat page loads that session normally.
- **Live sync both directions**: `useThread` already realtime-subscribes to messages + session metadata. Confirm `useConversations` and `useWorkTasks` also subscribe to `chat_sessions` UPDATE so status/title changes propagate to both lists instantly.
- `Index.tsx` (chat): if current session has `kind in ('task','both')`, show small badge "Linked task" with click-through to `/tasks?id=<work_task_id>`.

### 5. Card preview cleanup
`TaskCard.tsx`: drop "draft" badge. Show last message snippet (user or AI) from the linked thread instead of `draft_output`. `useWorkTasks` joins latest `chat_messages.content` per task.

## Files

**New**
- `supabase/migrations/<ts>_soft_delete_threads_tasks.sql` — adds `deleted_at` to `chat_sessions` + `work_tasks`, indexes.
- Cron job (via insert tool, not migration): daily purge of items past 30 days.
- `src/components/tasks/TaskTrash.tsx` + `src/components/chat/ChatTrash.tsx` — trash list view with Restore / Delete now.

**Edited**
- `src/components/tasks/TaskDetail.tsx` — thread-only layout, Mark done button, no tabs, no Run button, collapsible details.
- `src/components/tasks/TaskCard.tsx` — last-message snippet, no "draft" labels.
- `src/components/tasks/TaskBoard.tsx` + `TasksOverview.tsx` + `TasksSidebar.tsx` — 3-status columns + Trash link.
- `src/hooks/useWorkTasks.ts` — `STATUS_ORDER` 3 values, filter `deleted_at IS NULL`, `markDone()` helper that soft-deletes both sides, latest-message join.
- `src/hooks/useConversations.ts` — filter `deleted_at IS NULL`, add `softDelete` + `restore`, "Save as task" helper.
- `src/pages/Index.tsx` — linked-task badge when session is `kind='task'/'both'`.
- `supabase/functions/execute-task/index.ts` — stop writing `up_for_review`.
- Data backfill (insert tool): old statuses → `in_progress`.

## Constraints honored
Additive only. No new tables (just `deleted_at` columns + existing trash UX). 3 statuses replace 5. Apple Vision Pro minimal aesthetic. No emojis. RLS unchanged (user_id scoping already covers trash). Realtime via existing channels.
