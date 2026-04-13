

# AI Operations Platform — Final Build (All Polish Applied)

Every refinement from the full conversation is now locked in. This is the implementation-ready spec.

## Step 1: Database Migration

Create `work_tasks` table with all columns, triggers, indexes, RLS, and seed data (8 tasks including 1 archived).

Key decisions locked:
- `assigned_to`: unconstrained text, no CHECK (future-proof for new agents)
- All other enum-like fields: CHECK-constrained
- `completed_at` trigger: auto-set on status → completed, auto-clear on status leaving completed
- `updated_at` trigger: reuses existing `update_updated_at_column()`
- Indexes on `(user_id, status)`, `(user_id, archived_at, status)`, `(user_id, last_activity_at DESC)`, `(source_chat_session_id)`
- RLS: SELECT/INSERT/UPDATE/DELETE on `auth.uid() = user_id` + service_role full access

## Step 2: Frontend — Tasks Page + 8 Components

- `src/pages/Tasks.tsx` — layout with sidebar + content area
- `TasksSidebar.tsx` — Overview, Board, Active, Review, Completed, Activity
- `TasksOverview.tsx` — status counts, "AI Working Now", "Needs Review", recent completions, activity feed
- `TaskBoard.tsx` — 4-column Kanban using explicit order `['todo', 'in_progress', 'up_for_review', 'completed']`, drag-and-drop persists `board_position` + `status`
- `TaskCard.tsx` — title, type badge, priority dot, ai_status pulse
- `TaskDetail.tsx` — slide-out panel, full edit, AI timeline, markdown draft, comments, archive toggle, "Refine with AI"
- `TaskCreateForm.tsx` — new task dialog
- `TaskActivityLog.tsx` — timeline renderer

**New task `board_position`**: appends to bottom of column (SELECT MAX(board_position) + 1 for that status).

**"Refine with AI"**: same task — appends to `ai_activity_log`, updates `draft_output`, sets status to `in_progress`, `ai_status` to `executing`.

**Archive UX**: archive button in detail view only. Completed tasks can be unarchived. Archived tasks remain read/write.

## Step 3: Navigation + Routing

- Add "Tasks" with `ClipboardList` icon to `BottomNav.tsx`
- Add `/tasks` route to `App.tsx`

## Step 4: Chat Edge Function — `create_work_task` Tool

Parameters and defaults:
- `title` (required), `description` (required)
- `task_type` = `'general'`, `intent_type` = `'ops'`, `priority` = `'medium'`
- `assigned_to` = `'ai'`, `next_action` = `'waiting_on_ai'`

Mapped as `'_always_'` in TOOL_APP_MAP. Display name: `'Creating work task'`.

Identity rule: always creates new tasks by UUID. `source_chat_session_id` is a reference link, not a sync key. Updates only by known task ID.

## JSONB Shape Standards

```text
ai_activity_log: { timestamp, action, detail, actor, status? }
comments:        { id, timestamp, author, content }
attachments:     { id, name, url, type }
```

## Files

| File | Action |
|------|--------|
| `supabase/migrations/...` | New — table, triggers, indexes, RLS, seed |
| `supabase/functions/chat/index.ts` | Add `create_work_task` tool + handler |
| `src/pages/Tasks.tsx` | New |
| `src/components/tasks/*.tsx` | New (8 components) |
| `src/App.tsx` | Add `/tasks` route |
| `src/components/navigation/BottomNav.tsx` | Add Tasks tab |

