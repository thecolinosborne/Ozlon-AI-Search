# Fix two latest issues: signals-synthesize 401 + web_investigate "query required"

## Issue 1 — signals-synthesize 401 unauthorized

**Cause.** `resolveUser()` in `supabase/functions/signals-synthesize/index.ts` (lines 32–47) uses `sb.auth.getClaims(token)` and explicit-token `sb.auth.getUser(token)`. With `@supabase/supabase-js@2.49.1` and Supabase's signing-keys JWTs, both paths fail for some live sessions (we see this for the currently signed-in user). Other working functions (e.g. `signals-brief`, `research`) use the **header-injection pattern** and succeed.

**Fix (one file).** Replace `resolveUser()` with the same pattern used in `signals-brief` and `research`:

```ts
async function resolveUser(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  try {
    const { data, error } = await sb.auth.getUser();
    if (!error && data?.user?.id) return data.user.id;
  } catch (_) { /* ignore */ }
  // Last-resort fallback for older sessions
  try {
    const token = authHeader.slice(7);
    const { data } = await sb.auth.getUser(token);
    if (data.user?.id) return data.user.id;
  } catch (_) { /* ignore */ }
  return null;
}
```

Also add a one-line `console.warn("[signals-synthesize] auth failed; header present:", !!authHeader)` next to the 401 response (line 972) so future regressions are diagnosable from edge logs.

Cron path (`?mode=lookahead_tick` / `?mode=daily_digest_tick`) is untouched — it uses `x-cron-key`.

---

## Issue 2 — `web_investigate` returns "Investigation failed: query required"

Edge log shows the streaming upgrade firing and the research function rejecting it:
```
[web_investigate] delivered_via=stream
Tool result (web_investigate): FAILED Investigation failed: query required
```

**Cause.** `streamWebInvestigate()` in `supabase/functions/chat/index.ts` (lines 7449–7463) posts a **flat** body to `/functions/v1/research`:
```ts
body: JSON.stringify({
  action: 'web_investigate_stream',
  query: args.query,
  contextHint: args.contextHint,
}),
```
but `research/index.ts` (line 992) reads `const params = (body?.params ?? {})`, then `runInvestigation` requires `params.query` (line 766–767, throws "query required"). So the SSE emits an `error` event → chat surfaces "Investigation failed: query required".

The non-streaming path works because it goes through `_dispatcher.ts`, which already wraps args under `params` for `envelope: "nested"` integrations (line 47–49). The streaming path bypasses the dispatcher.

**Fix (one file).** Wrap the body under `params` in `streamWebInvestigate()`:

```ts
body: JSON.stringify({
  action: 'web_investigate_stream',
  params: {
    query: args.query,
    contextHint: args.contextHint,
  },
}),
```

That matches the envelope `research/index.ts` actually parses, with no changes to research itself.

---

## Verification

1. Deploy `signals-synthesize` and `chat`.
2. **Signals**: load `/signals`, trigger "Scan now" — expect 200, no `unauthorized`. Edge logs should be clean.
3. **Investigate**: send a chat message that triggers `web_investigate` (e.g. "research the best hair product ecommerce niche") — expect streamed task updates ("Planned N sub-queries", "Searched: …", "Synthesizing answer", "Self-critique complete") and a real answer instead of "Investigation failed: query required".

## Out of scope
No schema, RLS, UI, or other edge function changes. Two surgical fixes, two files.
