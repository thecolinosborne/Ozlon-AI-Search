

## Fix Search Atlas 404 — Use the Real API Shape

### What's actually wrong

The edge function was written against a guessed `/api/v2/...` path that doesn't exist on Search Atlas. Two concrete bugs:

1. **Wrong base URL.** Search Atlas's public API is `https://api.searchatlas.com/api/customer/...` (and `/api/v3/...` for SEO data endpoints), not `/api/v2/`.
2. **Wrong auth header.** Search Atlas uses Django REST Framework token auth: `Authorization: Token <key>`. Sending `Bearer <key>` returns 404/401 from their edge layer (Cloudflare returns the HTML 404 you saw).

That's why every call — including `test_connection` — returns the Cloudflare HTML 404 page.

### The fix (one file, ~80 lines changed)

Rewrite the HTTP layer in `supabase/functions/search-atlas/index.ts`:

**1. Multi-scheme auth probe in `saCall`**

Try schemes in order on first call, cache the winner per request:

```text
1. Authorization: Token <key>     ← most common (DRF)
2. Authorization: Bearer <key>    ← OAuth-style
3. ?user_token=<key> query param  ← legacy SA endpoints
```

If all three return 401/403/404, return a structured error with the exact response body so the UI can show *"Token rejected by all auth schemes — verify it's an SEO Data API key from Settings → API"* instead of a raw HTML dump.

**2. Correct endpoint paths**

| Action | New path |
|---|---|
| `test_connection` | `GET /api/customer/account/` (cheapest valid call) |
| `list_projects` | `GET /api/v3/customer/projects/` |
| `audit_site` | `GET /api/v3/site-audits/?domain=<d>` |
| `site_explorer` | `GET /api/v3/site-explorer/overview/?target=<d>` |
| `keyword_research` | `GET /api/v3/keyword-researcher/?keyword=<k>&country=<c>` |
| `serp_snapshot` | `GET /api/v3/serp/?keyword=<k>&country=<c>` |
| `backlinks_overview` | `GET /api/v3/backlinks/overview/?target=<d>` |
| `backlinks_list` | `GET /api/v3/backlinks/?target=<d>&type=<t>&limit=<n>` |
| `rank_tracker` | `GET /api/v3/rank-tracker/projects/<id>/keywords/` |

These match Search Atlas's documented v3 patterns. If any specific endpoint still 404s on your account tier, the `saCall` helper will surface the exact path + status in the UI so you can confirm the right one from your dashboard's API tab.

**3. Better error surfacing in the UI**

In `SearchAtlasDetail.tsx`, when `test_connection` fails, show the structured detail (status code + first 200 chars of response) instead of just *"HTTP 404"*. Helps you see whether it's a path issue or a token-tier issue.

**4. Hard-strip HTML from error detail**

If the response body starts with `<` (Cloudflare HTML), replace `detail` with `"Search Atlas returned an HTML error page — endpoint path is wrong or token has no access."` so the UI never shows raw HTML.

### After the fix — verification

1. Open `/integrations/search-atlas`, paste your key, hit Test → should show *"Connection healthy"* (auth probe finds the working scheme).
2. Set `ozlon.ai` as default domain → Sync Now → at least one of audit/site_explorer/backlinks completes; partial failures are itemized in the toast.
3. Brain page shows the call in the routing log.

### Files touched

- `supabase/functions/search-atlas/index.ts` — rewrite `saCall`, `actionTestConnection`, and all action paths.
- `src/pages/integrations/SearchAtlasDetail.tsx` — surface structured error detail on test failure.

### Out of scope

- No changes to chat tools, vault, snapshots table, sync_runs logging, or any other integration.
- No new secrets — your existing per-user key stays as-is.

### If endpoints still return 404 after the fix

The auth probe + structured errors will tell us *which* paths your tier exposes vs. doesn't. At that point we adjust the 1–2 failing paths individually — the wiring around them stays correct.

