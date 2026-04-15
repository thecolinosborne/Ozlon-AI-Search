

## Full-Scale ClickUp AI Integration

### Current State
The ClickUp integration already has ~30 actions in both the edge function and chat tool definitions. However, several gaps prevent full-scale operation:

### Problems to Fix

**1. Missing `update_task` handler in edge function**
The chat AI calls `update_task` but the edge function has no matching `case`. It falls through to "Unknown action" error.

**2. Subtask creation broken — param mismatch**
Chat sends `parentId` but edge function destructures `params.parent`. Subtasks always fail with "parent taskId required".

**3. Subtask listId not auto-resolved**
Creating a subtask requires a `listId`, but the chat tool doesn't send one. Need to fetch the parent task's `list.id` automatically.

**4. Missing workspace-wide capabilities**
No tools for: searching tasks across workspace, listing all spaces/folders/lists, time tracking, custom fields, listing workspace members, setting task priority directly, or bulk operations.

**5. No `set_priority` dedicated tool**
Priority can only be set during create. No standalone tool to change priority on existing tasks.

### Implementation Plan

#### File 1: `supabase/functions/clickup/index.ts`

Add these missing cases to the switch block:

- **`update_task`** — `PUT /task/{taskId}` with name, description, priority, status, due_date, assignees
- **Fix `create_subtask`** — Accept both `parentId` and `parent`; auto-fetch parent task's `list.id` if no listId provided
- **`move_task`** — `POST /list/{listId}/task/{taskId}` to move a task to a different list
- **`get_task_dependencies`** — `GET /task/{taskId}/dependency`
- **`add_dependency`** — `POST /task/{taskId}/dependency`
- **`delete_dependency`** — `DELETE /task/{taskId}/dependency`
- **`list_space_tags`** — `GET /space/{spaceId}/tag` to discover available tags
- **`list_workspace_members`** — `GET /team/{teamId}/member` (needed for assignee resolution)
- **`get_list_statuses`** — `GET /list/{listId}` to see available status options
- **`bulk_update_tasks`** — Sequential `PUT` on multiple task IDs

#### File 2: `supabase/functions/chat/index.ts`

Add matching tool definitions and dispatch handlers for each new action:

**New tool definitions (in the tools array):**
- `search_clickup_tasks` — workspace-wide search with query string
- `list_clickup_spaces` — list all spaces
- `list_clickup_lists` — list all lists (workspace-wide)
- `list_clickup_members` — list workspace members (for assignee discovery)
- `move_clickup_task` — move task to a different list
- `set_clickup_priority` — standalone priority change
- `start_clickup_timer` / `stop_clickup_timer` — time tracking
- `get_clickup_time_entries` — view time tracked
- `get_clickup_custom_fields` — list custom fields for a list
- `set_clickup_custom_field` — set a custom field value
- `list_clickup_task_dependencies` — view dependencies
- `add_clickup_dependency` — add task dependency
- `delete_clickup_checklist` — remove a checklist
- `delete_clickup_checklist_item` — remove a checklist item

**New dispatch cases (in the tool execution switch):**
Each maps to `callClickUpEdge(action, params)` with appropriate parameter translation.

**Tool availability map updates:**
All new tools added as `'_always_'` (same as existing ClickUp tools).

#### Deploy
- Deploy `clickup` edge function after changes

### What This Enables

After implementation, the AI can conversationally:
- Search tasks across the entire workspace by keyword, status, assignee, tags, due dates
- Create tasks with full details (description, priority, due date, assignees) in any list
- Create and manage subtasks (auto-resolves parent list)
- Update any field on existing tasks (name, description, priority, status, due date)
- Move tasks between lists
- Manage dependencies between tasks
- Track time (start/stop timers, view entries)
- Work with custom fields
- Browse workspace structure (spaces, folders, lists, members)
- Manage checklists, comments, tags (already working)

### Files Changed
- `supabase/functions/clickup/index.ts` — add `update_task`, fix `create_subtask`, add 8 new action handlers
- `supabase/functions/chat/index.ts` — add ~15 new tool definitions, dispatch cases, and availability map entries

