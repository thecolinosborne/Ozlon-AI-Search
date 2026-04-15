

## Remove "Workspace Inputs" from ClickUp Detail

### Why
The backend (`resolveTeamId`) auto-discovers the team from the API token, and `getListId` reads `default_list_id` from the `clickup_integration_state` table (set by the Browse Workspace picker). The manual Team ID and Default List ID text inputs serve no purpose — they don't persist to the database and only get passed as request params that the backend ignores when it already has better sources.

### Changes

**File: `src/pages/integrations/ClickUpDetail.tsx`**

1. Remove the `teamIdInput` and `defaultListIdInput` state variables
2. Remove the entire "Workspace Inputs" card (Team ID / Default List ID text inputs)
3. Simplify `getAuthParams()` to only pass `apiToken` (the backend resolves team/list automatically)
4. In `handleCreateTestTask`, rely on the backend's `getListId()` DB lookup instead of passing `listId` from local state
5. When `test_connection` or `connect` returns `team_id`/`list_id`, store them in integration settings for display only — don't use them as required inputs

This is a removal-only change. The Browse Workspace picker remains as the proper way to select a default list.

