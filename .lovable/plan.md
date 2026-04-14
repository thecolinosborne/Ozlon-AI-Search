

## Fix: ClickUp Invalid List ID

### Problem
Your `CLICKUP_DEFAULT_LIST_ID` secret is set to `6-901710746417`, but ClickUp's API rejects it — `list_accessible: false`. The `getListId()` helper also strips the `6-` prefix, making it `901710746417`, which is equally invalid. No task creation can work until this is fixed.

Additionally, the edge function has no way to browse your ClickUp workspace to discover valid list IDs — you'd have to manually look them up.

### Fix

**1. Add a `list_spaces` and `list_lists` action to the ClickUp edge function**

This lets you (and the settings UI) browse your workspace to find the correct list ID:
- `list_spaces` → calls `GET /team/{teamId}/space` → returns all spaces
- `list_folders` → calls `GET /space/{spaceId}/folder` → returns folders in a space  
- `list_lists` → calls `GET /folder/{folderId}/list` → returns lists in a folder
- Also: `GET /space/{spaceId}/list` for folderless lists

**2. Add a List Picker to the ClickUp integration detail page**

Replace the blind "list ID from env" approach with a dropdown that:
- Fetches spaces → folders → lists from the API
- Lets you select the correct list
- Saves it via `update_config` (stores in `clickup_integration_state` table)

**3. Fix `getListId()` to prefer DB-stored list over env var**

Update priority: `params.listId` → config row `default_list_id` → env `CLICKUP_DEFAULT_LIST_ID`. This way the UI-selected list takes precedence.

**4. Update the `CLICKUP_DEFAULT_LIST_ID` secret**

Once we discover the correct list ID from the picker, update the secret to the valid value.

### Files Changed
| File | Change |
|---|---|
| `supabase/functions/clickup/index.ts` | Add `list_spaces`, `list_folders`, `list_lists` actions; fix `getListId` to check DB config first |
| `src/pages/integrations/ClickUpDetail.tsx` | Add list picker UI that browses spaces/folders/lists |

