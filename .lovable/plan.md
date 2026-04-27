## Problem
Your last chat request timed out because the `research` edge function (used by `web_search` and `deep_research` tools) calls `supabase.auth.getClaims(token)` — a method that **does not exist** on the Supabase JS client. Every web_search invocation from the chat tool loop fails with:

```
Tool web_search failed: supabase.auth.getClaims is not a function
```

The AI retried 5+ times across two tool-loop iterations, then the stream aborted at the 2-minute client timeout → user saw **"Response timed out. Please try again."**

This is unrelated to Signals/Brain routing — it's a regression in the auth resolution helper inside `supabase/functions/research/index.ts`.

## Fix (surgical, one file)

**File:** `supabase/functions/research/index.ts` (around line 986)

Replace the broken `getClaims` call with the standard pattern used across the rest of the codebase (e.g. `signals-create`, `signals-synthesize`, `chat`):

```ts
// BEFORE (broken)
const { data: claims } = await (supabase.auth as any).getClaims(token);
const userId = claims?.sub ?? null;

// AFTER (works)
const sb = createClient(SUPABASE_URL, ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${token}` } },
});
const { data } = await sb.auth.getUser();
const userId = data.user?.id ?? null;
```

I'll read the surrounding context (lines ~960–1010) before editing so the change matches the existing imports and error-handling style of that helper.

## Verification
1. After the patch deploys, trigger a chat request that calls `web_search` (e.g. "search the web for X").
2. Confirm in `chat` edge logs that `[dispatcher] web_search → research/web_search FAILED` no longer appears.
3. Confirm `research` edge logs show successful Tavily calls instead of `unknown failed: supabase.auth.getClaims is not a function`.

## Out of scope
- No Signals changes.
- No Brain/gauntlet changes.
- No tool-loop or timeout tuning — fixing the underlying error is sufficient.
