

## Fix YouTube Integration: OAuth Persistence + Cleanup

### Problems Found

**1. OAuth race condition (root cause)**
When Google redirects back with `?code=...`, two things fire concurrently in the `useEffect`:
- `loadConnection()` calls `get_connection` — at this point the OAuth token hasn't been stored yet, so it returns `oauthStatus: "disconnected"`
- `handleOAuthCallback(code)` calls `oauth_callback` to exchange the code and store the token

Whichever finishes last wins. If `loadConnection` finishes after `handleOAuthCallback`, it overwrites `oauthConnected` back to `false`. The API key also appears "wiped" because the page may timeout or error during this race.

**2. Sync controls are confusing and unused**
Manual Sync and Recent Sync Runs sections add noise. User confirmed: remove them.

### Fix Plan

**Step 1: Fix OAuth callback flow in `YouTubeDetail.tsx`**
- If URL contains `?code=`, skip `loadConnection` and process the OAuth callback first
- After the callback succeeds (or fails), THEN call `loadConnection` to refresh all state
- This eliminates the race condition entirely

**Step 2: Remove Manual Sync + Recent Sync Runs UI**
- Remove the "Manual Sync" card (sync_channels/sync_videos buttons)
- Remove the "Recent Sync Runs" card and related state (`runs`, `loadingRuns`, `loadRuns`, `runSync`, `SyncRun` type)
- Keep the backend sync actions intact (they can be used by the chat agent later)

**Step 3: Redeploy edge function (if needed)**
- The backend `youtube` edge function is already correct — no changes needed there
- The OAuth callback handler properly stores tokens in `integration_connections` with `auth_type: "oauth2"`

### Files Changed
- `src/pages/integrations/YouTubeDetail.tsx` — fix callback ordering, remove sync UI

