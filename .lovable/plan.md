

## Stop Guessing Search Atlas — Probe & Pin the Real API

### Why we're stuck

Two rounds of "fix" have shipped guessed endpoints (`/api/v2/`, then `/api/v3/`, then `/api/customer/`). All still return Cloudflare 404. The function has zero diagnostic logging, so we can't see what host/path/auth combination Search Atlas actually accepts for **your specific token**.

We need to stop guessing and probe.

### Step 1 — Add a `diagnose` action to the edge function

One new action in `supabase/functions/search-atlas/index.ts` that systematically probes the Search Atlas API surface and returns a full report. No UI needed — you'll just call it from the Detail page with one button.

It probes a matrix of `[host] × [path] × [auth scheme]`:

**Hosts:**
- `https://api.searchatlas.com`
- `https://sa.searchatlas.com`
- `https://app.searchatlas.com`

**Paths (cheap, likely-existing endpoints):**
- `/api/customer/account/`
- `/api/customer/projects/`
- `/api/v2/customer/account/`
- `/api/v3/customer/account/`
- `/api/account/`
- `/api/projects/`
- `/api/keyword-researcher/`
- `/v2/account/`

**Auth schemes:**
- `Authorization: Token <key>`
- `Authorization: Bearer <key>`
- `Authorization: ApiKey <key>`
- `?user_token=<key>` query param
- `?api_key=<key>` query param
- `?token=<key>` query param

For each combo it records: `status`, `content-type`, first 120 chars of response body. Returns the full matrix as JSON, sorted with any `2xx` results first.

This single call (~30 requests, runs in parallel) will conclusively show: *which host responds at all, which paths exist, and which auth scheme your token uses.* No more guessing.

### Step 2 — Add a "Run Diagnostics" button on the Detail page

In `src/pages/integrations/SearchAtlasDetail.tsx`, below the Test Connection button, add a small "Run API Diagnostics" button that calls `search-atlas/diagnose` and renders the result as a compact table:

```text
✓ 200  api.searchatlas.com  /api/customer/account/   Token <key>
✗ 404  api.searchatlas.com  /api/v3/site-audits/     Token <key>
✗ 401  api.searchatlas.com  /api/customer/account/   Bearer <key>
...
```

The first green row tells us the right host + path + auth. Everything after that is mechanical: rewrite the 8 action handlers to use that base + scheme.

### Step 3 — Pin the working combo + rewrite handlers

Once diagnostics returns at least one `2xx`, I'll:

1. Update `BASE_URL` and the auth probe to lock in the winning scheme (drop the multi-scheme probe — it's just slowing every call down).
2. Rewrite each of the 8 action handlers (`audit_site`, `site_explorer`, `keyword_research`, `serp_snapshot`, `backlinks_overview`, `backlinks_list`, `list_projects`, `rank_tracker`) to use paths *relative to the verified prefix*. If a specific path 404s, the diagnostic output usually reveals the sibling path that works (e.g. if `/api/customer/projects/` works, `/api/customer/site-audits/` is likely the audit path).
3. Re-test each chat tool via `supabase--curl_edge_functions` so we know they all return real data before declaring done.

### Step 4 — If diagnostics returns zero 2xx responses

That means the token itself isn't a valid SEO API token (likely a partner/dashboard session token instead). The diagnostic table will show this clearly — typically every row will be `403 {"detail":"Authentication credentials were not provided"}` or similar. In that case I'll surface a clear UI message in the Detail page telling you exactly where in the Search Atlas dashboard to grab the right token (Settings → API → "SEO Data API Key"), and stop until you paste that one in.

### Files touched

- `supabase/functions/search-atlas/index.ts` — add `diagnose` action (~80 lines, no other changes).
- `src/pages/integrations/SearchAtlasDetail.tsx` — add "Run API Diagnostics" button + result table (~60 lines).

### After Step 3 — verification

1. Diagnostics shows ≥1 green row → I pin host/path/auth.
2. Test Connection passes.
3. Sync Now on `ozlon.ai` returns real audit/explorer/backlinks data.
4. From chat: *"Audit ozlon.ai with Search Atlas"* → tool returns structured data, not an error.

### Out of scope

- No new connectors, secrets, DB changes, or UI redesigns.
- No edits to chat tools, vault, snapshots table, or any other integration.
- No changes to the 8 chat tool definitions — only their underlying URLs.

### Why this approach instead of more guessing

Search Atlas doesn't publish their REST docs publicly and the sandbox can't reach their dashboard. Instead of a third round of guessed paths, we let *your* token tell us — in one diagnostic call — exactly what works. That's the only way to break the 404 loop reliably.

