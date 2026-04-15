

## Wire All ClickUp Actions into Chat AI Tools

### The gap
The ClickUp edge function already supports 20+ actions (create, update, delete tasks, comments, subtasks, checklists, tags, assignees, due dates, custom fields, time tracking). But the chat AI only knows about 2 of them (`create_clickup_task`, `list_clickup_tasks`). The AI literally cannot call the other actions because they aren't registered as tools.

### What needs to happen
Add ~15 new tool definitions and their corresponding handler cases in `supabase/functions/chat/index.ts`. This is the same pattern already used for ClickUp and GHL — define the tool schema so the AI knows it exists, then add a `case` in the tool executor switch to call `callClickUpEdge()` with the right action.

### New tools to register

| Tool name | Edge action | Purpose |
|-----------|------------|---------|
| `update_clickup_task` | `update_task` | Update name, description, priority |
| `delete_clickup_task` | `delete_task` | Delete a task |
| `set_clickup_task_status` | `set_task_status` | Change task status |
| `set_clickup_due_date` | `set_due_date` | Set/clear deadlines |
| `set_clickup_assignees` | `set_assignees` | Add/remove assignees |
| `create_clickup_subtask` | `create_subtask` | Add subtask to a parent |
| `create_clickup_comment` | `create_comment` | Comment on a task |
| `list_clickup_comments` | `list_comments` | Read task comments |
| `update_clickup_comment` | `update_comment` | Edit a comment |
| `delete_clickup_comment` | `delete_comment` | Remove a comment |
| `add_clickup_tag` | `add_tag` | Tag a task |
| `remove_clickup_tag` | `remove_tag` | Untag a task |
| `create_clickup_checklist` | `create_checklist` | Add checklist to task |
| `create_clickup_checklist_item` | `create_checklist_item` | Add item to checklist |
| `update_clickup_checklist_item` | `update_checklist_item` | Toggle/rename checklist item |
| `get_clickup_task` | `get_task` | Get full task details |

### File to update
`supabase/functions/chat/index.ts` — two sections:
1. **Tool definitions array** (~line 1238): Add 16 new tool schemas after the existing ClickUp entries
2. **Tool executor switch** (~line 2785): Add 16 new `case` blocks that call `callClickUpEdge()` with the matching action and params

### No other files need changes
The edge function already handles all these actions. The frontend already passes `enableTools: true`. Once the chat AI has these tool definitions, you can say things like "comment on my ClickUp task" or "set the due date to Friday" and it will work.

