

## Fix: Chat Auth Token + Tavily Retry

### Root Cause Summary

1. **Wrong bearer token**: `chatService.ts` line 154 hardcodes `VITE_SUPABASE_PUBLISHABLE_KEY` (the anon key) as the Authorization header. The edge function calls `supabase.auth.getUser(token)` which returns null for anon keys, so authenticated tools like `create_work_task` fail with "Could not identify user."

2. **No Tavily retry**: The `deep_research` handler (line 3162) makes a single Tavily fetch. If it gets a transient 429/5xx or network error, the research immediately fails with no retry or detailed logging.

### Changes

**File 1: `src/services/chatService.ts`** — Send user JWT instead of anon key

- Add `import { supabase } from "@/integrations/supabase/client";` at the top
- Before the `fetch(CHAT_URL, ...)` call, get the session token:
  ```typescript
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  ```
- Change the Authorization header from the hardcoded anon key to `Bearer ${token}`
- This is a 3-line change; all other behavior (SSE parsing, callbacks) stays identical

**File 2: `supabase/functions/chat/index.ts`** — Add retry to Tavily fetch in `deep_research`

- Extract the Tavily fetch (lines 3162–3173) into a retry loop (1 retry, ~2s delay)
- Retry only on network errors, 429, or 5xx status codes
- On failure, log the HTTP status and truncated response body (first 500 chars, no secrets since `api_key` is in the request body not the response)
- Non-retryable errors (4xx other than 429) fail immediately as before
- Approximate shape:
  ```typescript
  let tavilyRes: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      tavilyRes = await fetch('https://api.tavily.com/search', { ... });
      if (tavilyRes.ok || (tavilyRes.status < 500 && tavilyRes.status !== 429)) break;
      console.warn(`[deep_research] Tavily returned ${tavilyRes.status}, attempt ${attempt + 1}/2`);
    } catch (e) {
      console.warn(`[deep_research] Tavily network error, attempt ${attempt + 1}/2:`, e);
    }
    if (attempt === 0) await new Promise(r => setTimeout(r, 2000));
  }
  if (!tavilyRes || !tavilyRes.ok) { /* existing failure handling */ }
  ```
- Everything after the Tavily fetch (synthesis, DB updates) remains unchanged

**File 3: Deploy edge function** — Redeploy `chat` after changes

### Changed Files
| File | What changed |
|---|---|
| `src/services/chatService.ts` | Import supabase client, use session JWT as bearer token |
| `supabase/functions/chat/index.ts` | Wrap Tavily fetch in 1-retry loop with logging |

### Manual Test Plan
1. **Auth token**: Log in → send a chat message that triggers `create_work_task` → verify the task is created (previously failed). Check edge function logs for the resolved user ID.
2. **Anonymous fallback**: Log out → send a basic chat message → verify it still works with the anon key fallback.
3. **Tavily retry**: Trigger `deep_research` → verify it completes. To test retry, temporarily break the Tavily key and check logs show the retry attempt with status/body.

### Edge Cases
- **No session**: If `getSession()` returns null (logged-out user), falls back to anon key — preserves guest chat.
- **Tavily permanent failure (400)**: Does not retry; fails immediately as before.
- **Tavily timeout**: Network errors are caught and retried once.

