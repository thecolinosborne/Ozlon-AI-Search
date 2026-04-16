

# Fix YouTube Integration: Persistent API Key Display and OAuth Disconnect/Reconnect

## Problems
1. **API key disappears after OAuth authorization** — When OAuth completes and the connection reloads, the API key masked hint vanishes because `loadConnectionWithRetry` may not return `apiKeyMasked` or the state gets reset.
2. **No way to disconnect OAuth and reconnect** — When OAuth is active, the UI only shows "OAuth is active" with no option to disconnect or re-authorize.

## Changes

### 1. `src/pages/integrations/YouTubeDetail.tsx`

**API key persistence fix:**
- In `loadConnectionWithRetry`, ensure `apiKeyMasked` from the backend response is preserved in `savedConn` state. Currently the code sets `conn.apiKeyConfigured` but the `apiKeyMasked` field depends on the backend returning it — verify it's being set from the response.
- When OAuth callback completes and triggers `loadConnectionWithRetry`, the `savedConn` state should retain `apiKeyMasked` from the previous load if the new response doesn't include it.

**OAuth disconnect/reconnect button:**
- In the OAuth section (lines 544-558), when `oauthConnected` is true, add a "Disconnect OAuth" button and a "Re-authorize" button alongside the "Active" status.
- "Disconnect OAuth" calls a new backend action `oauth_disconnect` (or reuses `disconnect` with a flag) to clear only the OAuth tokens while keeping the API key connection intact.
- "Re-authorize" simply calls `handleAuthorize` again to start a fresh OAuth flow.

### 2. `supabase/functions/youtube/index.ts`

**Ensure `get_connection` returns `apiKeyMasked`:**
- Verify the `get_connection` action reads the stored API key from `metadata` and returns a masked version (e.g., `••••XXXX` showing last 4 chars).

**Add `oauth_disconnect` action:**
- Clear the OAuth tokens (`access_token`, `refresh_token`, `token_expiry`) from the connection's metadata without deleting the entire connection row.
- Return updated connection status.

## UI Result
- API key shows "Configured" with masked hint at all times when saved, regardless of OAuth state.
- OAuth section shows "Active" badge + "Disconnect OAuth" and "Re-authorize" buttons when connected.
- After disconnecting OAuth, user can re-authorize cleanly.

