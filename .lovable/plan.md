

## Fix YouTube Integration — Proper Key Management + End-to-End Sync

### Problem
1. The API key lives only in component state — lost on every page reload. Users must re-enter it each time they sync.
2. Raw `<input type="password">` is used instead of the reusable `ApiKeyInput` component (which has masked display, "Configured" badge, and "Update" flow).
3. The backend upsert uses `onConflict: "user_id,provider,auth_type,external_account_id"` but `external_account_id` can be NULL, and Postgres treats NULLs as distinct in unique constraints — so upserts silently insert duplicates instead of updating.

### Changes

**1. Database migration** — Fix the unique constraint on `integration_connections`
- Create a unique index using `COALESCE(external_account_id, '__null__')` so NULL values are treated as equal, preventing duplicate rows.

**2. Edge function `supabase/functions/youtube/index.ts`**
- On `connect`: store the actual API key encrypted-at-rest in `metadata.api_key` (it's already behind RLS + service role). Return `api_key_masked` so the frontend can display it.
- Add a `get_connection` action so the frontend can load saved connection state (masked key, channel ID, label) on page load.
- On `sync_channels` / `sync_videos`: if `apiKey` param is empty, fall back to the stored `metadata.api_key` from the connection row — so syncs work without re-entering the key.

**3. Frontend `src/pages/integrations/YouTubeDetail.tsx`**
- Replace the raw API key `<input>` with the `ApiKeyInput` component. On save, call `connect` (or a new `update_key` action) to persist + validate the new key.
- On mount, call `get_connection` to load the existing connection state (masked key hint, channel ID, connection status) so the page shows "Configured" with masked `***abcd` immediately.
- Channel ID input: pre-fill from saved connection, allow editing.
- When user enters a new API key via the `ApiKeyInput` "Update" flow, it replaces the old key in the database.
- Keep OAuth, Upload, Manual Sync, and Sync Runs sections as-is.

### What stays unchanged
- OAuth authorize/callback/upload flow
- Sync runs display
- Manual sync buttons
- Backend sync logic (channels/videos)

### Files modified
- `supabase/migrations/[new]` — unique index fix
- `supabase/functions/youtube/index.ts` — store key, add `get_connection`, fallback key on sync
- `src/pages/integrations/YouTubeDetail.tsx` — use `ApiKeyInput`, load saved state on mount

