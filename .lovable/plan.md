
Root cause

This likely is not a true backend disconnect. From the code, the YouTube page can look disconnected even when part of the integration is still connected:

1. `loadConnection()` silently treats any error/timeout like “no connection” instead of “status refresh failed” (`src/pages/integrations/YouTubeDetail.tsx`).
2. `get_connection` only loads the API-key connection row (`auth_type = "api_key"`), but upload auth is stored separately as an OAuth row (`auth_type = "oauth2"`) in `supabase/functions/youtube/index.ts`.
3. The page mixes both flows into one connection state, so if one side fails to load, the whole UI can appear disconnected.
4. `oauth_status` marks OAuth as disconnected whenever the short-lived access token is expired, even though refresh logic exists later in upload flow.
5. The “Update Channel” path currently reuses `connect` with an empty API key, which can make key rotation/update feel broken.

Plan

1. Split YouTube into two explicit states
   - Data API connection
   - Upload OAuth connection
   - Show them separately in the UI and derive overall status from both.

2. Stop false disconnects on refresh
   - Keep the last known connection state when status checks timeout/fail.
   - Show a soft warning instead of resetting to disconnected.

3. Fix OAuth status handling server-side
   - Update `oauth_status` to refresh expired access tokens when a refresh token exists.
   - Return clearer states so frontend can distinguish expired vs disconnected vs backend error.

4. Fix API key rotation/update
   - Add/update a proper backend update path so entering a new key replaces the old stored key on the same connection.
   - Keep masked key display synced after replacement.
   - Allow channel/account metadata updates without forcing a brand-new key entry.

5. Tighten the page UX
   - Show whether sync/analytics is ready, whether uploads are ready, and what exactly is missing.
   - Surface backend `last_error` instead of swallowing it.

6. Verify end-to-end after implementation
   - Connect API key, reload, sync channel data
   - Authorize OAuth, reload, upload a video
   - Replace API key, confirm old one is swapped out and sync still works
   - Confirm the page never falsely drops to disconnected on transient failures

Files to update
- `src/pages/integrations/YouTubeDetail.tsx`
- `supabase/functions/youtube/index.ts`

Likely no database migration is required unless we decide to add extra status metadata fields.
