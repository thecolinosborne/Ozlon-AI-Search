

## Expand ClickUp Edge Function — Full API Coverage

### Summary
Add ~15 new action cases to the ClickUp edge function so the chat AI can manage tasks end-to-end. Minimal frontend change — just swap "Create Test Task" for a generic "Test Connection" button.

### New actions to add in `supabase/functions/clickup/index.ts`

| Action | Method | ClickUp endpoint | Purpose |
|--------|--------|-----------------|---------|
| `delete_task` | DELETE | `/task/{id}` | Remove tasks |
| `set_task_status` | PUT | `/task/{id}` | Change status field |
| `set_due_date` | PUT | `/task/{id}` | Set/clear deadlines |
| `set_assignees` | PUT | `/task/{id}` | Add/remove assignees |
| `add_tag` | POST | `/task/{id}/tag/{tag}` | Tag tasks |
| `remove_tag` | DELETE | `/task/{id}/tag/{tag}` | Untag tasks |
| `update_comment` | PUT | `/comment/{id}` | Edit comments |
| `delete_comment` | DELETE | `/comment/{id}` | Remove comments |
| `create_checklist` | POST | `/task/{id}/checklist` | Add checklists |
| `create_checklist_item` | POST | `/checklist/{id}/checklist_item` | Add checklist items |
| `update_checklist_item` | PUT | `/checklist/{id}/checklist_item/{itemId}` | Toggle/rename items |
| `get_custom_fields` | GET | `/list/{id}/field` | List custom fields |
| `set_custom_field` | POST | `/task/{id}/field/{fieldId}` | Set field values |
| `list_members` | GET | `/task/{id}/member` | See task members |
| `get_time_entries` | GET | `/team/{id}/time_entries` | Pull time tracking |
| `start_time_entry` | POST | `/team/{id}/time_entries/start` | Start timer |
| `stop_time_entry` | POST | `/team/{id}/time_entries/stop` | Stop timer |

### Frontend change — `src/pages/integrations/ClickUpDetail.tsx`
- Remove "Create Test Task" and "Fetch Tasks" quick action buttons
- Keep only a single "Test Connection" button for diagnostics
- No new UI sections — all real interactions go through chat

### Files to update
1. `supabase/functions/clickup/index.ts` — add new switch cases
2. `src/pages/integrations/ClickUpDetail.tsx` — simplify quick actions

### No database changes needed

