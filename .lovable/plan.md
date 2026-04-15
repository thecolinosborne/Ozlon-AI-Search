

## Fix YouTube Detail Page Infinite Loading

### Root Cause
`supabase.functions.invoke("youtube")` hangs in the Lovable preview environment — the promise never settles, so `loadingConnection` stays `true` and the spinner shows forever. The backend itself is fine (confirmed via direct curl — returns 200).

### Fix

**File: `src/pages/integrations/YouTubeDetail.tsx`**

Add a timeout wrapper to both `loadConnection` and `checkOAuthStatus` so they abort after 8 seconds:

```typescript
const withTimeout = <T>(promise: Promise<T>, ms = 8000): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
```

Then wrap the calls:
- `loadConnection`: `await withTimeout(callYouTube("get_connection"))` — on timeout, catch silently and set `loadingConnection = false`
- `checkOAuthStatus`: `await withTimeout(callYouTube("oauth_status"))` — on timeout, catch silently

This is a one-file, surgical change. The page will render in its normal disconnected state if the request hangs, instead of spinning forever.

### No other changes
- Edge function is confirmed working
- OAuth, sync, upload sections unchanged

