## What's broken

Two tools fail with `schema_gap` errors despite their advertised schemas:

1. **`search_google_drive`** → backend `google-drive/search_files` requires `name`, but the chat router maps `query → q`. The Drive edge function only reads `params.name` (line 62 of `google-drive/index.ts`) and ignores `q`. Result: every search fails with `name is required`.

2. **`ghl_search_contacts`** → backend GHL `/contacts/search` rejects `pageSize: <number>` from V2 with `pageLimit must be a number conforming to the specified constraints`. The chat handler sends `pageSize`, GHL V2 actually wants `pageLimit`. Also `query` should be wrapped (V2 expects `pageLimit` + a `query` string at top level — current shape is mostly OK but the size field name is wrong).

Both bugs sit on the **chat side** (the AI never reaches the manifest tools — it uses the legacy hardcoded handlers in `chat/index.ts`). Fixing the manifest alone will not help. Need to fix **chat handlers** AND keep the manifest correct.

## Fixes (surgical, additive)

### 1. `search_google_drive` — `supabase/functions/chat/index.ts`

**Line 3010** (legacy router map):
```ts
search_google_drive: { fn: 'google-drive', action: 'search_files',
  mapArgs: (a) => ({ name: a.query, pageSize: a.max_results }) },
```
Change `q: a.query` → `name: a.query` so the edge function's `params.name` check passes.

**Line 3464** (legacy direct handler — the one actually hit): already passes `{ name: args.query }`. Leave as-is. Verify no other call paths send `q`.

**Edge function `google-drive/index.ts` lines 61-71**: additionally accept `q` as a fallback so future callers don't trip the same bug:
```ts
const name = String((params as AnyJson).name || (params as AnyJson).q || (params as AnyJson).query || "");
if (!name) return jsonErr("name (or q/query) is required");
```

**Manifest `_shared/integrations/google-drive.ts` line 32**: already maps `query → name`. Leave.

### 2. `ghl_search_contacts` — `supabase/functions/chat/index.ts` line 3617-3627

GHL V2 `/contacts/search` body shape:
```json
{ "locationId": "...", "pageLimit": 20, "query": "Kalvin Bridgewater" }
```

Replace `pageSize` with `pageLimit`, clamp to 1-100 (V2 max), and keep `query` top-level:
```ts
case 'ghl_search_contacts': {
  const GHL_LOCATION_ID = (ghlCreds?.locationId || '');
  if (!GHL_LOCATION_ID) return { success: false, result: 'GoHighLevel location ID not configured.' };
  const rawLimit = Number(args.limit ?? 20);
  const pageLimit = Math.max(1, Math.min(100, isFinite(rawLimit) ? rawLimit : 20));
  const searchBody: Record<string, unknown> = { locationId: GHL_LOCATION_ID, pageLimit };
  if (args.query) searchBody.query = String(args.query);
  if (args.filters) { try { Object.assign(searchBody, JSON.parse(args.filters as string)); } catch { /* ignore */ } }
  const data = await callGHL('/contacts/search', 'POST', searchBody, ghlCreds?.apiKey) as { contacts?: {...}[] };
  ...
}
```

Also fix the GHL edge function path (`gohighlevel/index.ts` line 207-212) to coerce a stray `pageSize` → `pageLimit` defensively, so manifest callers (`ghl_search_contacts` from manifest, line 90 of `_shared/integrations/gohighlevel.ts` which sends `limit`) don't break either:
```ts
case 'search_contacts': {
  const body = { locationId: GHL_LOCATION_ID, ...reqBody };
  if (body.limit && !body.pageLimit) { body.pageLimit = Math.min(100, Math.max(1, Number(body.limit))); delete body.limit; }
  if (body.pageSize && !body.pageLimit) { body.pageLimit = Math.min(100, Math.max(1, Number(body.pageSize))); delete body.pageSize; }
  endpoint = `${GHL_BASE_URL}/contacts/search`;
  method = 'POST';
  fetchBody = JSON.stringify(body);
  break;
}
```

And manifest `_shared/integrations/gohighlevel.ts` line 90 — change `limit: a.limit` → `pageLimit: a.limit ?? 20` so the manifest path is correct at the source too.

## Verification

After deploy:
1. From chat: "search drive for Daddy Stroller Club Kalvin notes" → expect file list, not `name is required`.
2. From chat: "find Kalvin Bridgewater in GHL contacts" → expect contact rows with id/email/phone, not `pageLimit must be a number`.
3. Send the previously-drafted email to Kalvin + cc Carmen once her email is resolved by the working contact search.

## Files touched

- `supabase/functions/chat/index.ts` (2 small handler edits)
- `supabase/functions/google-drive/index.ts` (accept `q`/`query` fallback)
- `supabase/functions/gohighlevel/index.ts` (coerce limit/pageSize → pageLimit)
- `supabase/functions/_shared/integrations/gohighlevel.ts` (manifest mapArgs)

No UI, no DB, no schema changes. Both edge functions auto-deploy.
