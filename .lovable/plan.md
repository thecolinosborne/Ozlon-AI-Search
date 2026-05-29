
## 1. Add GSC sitemap chat tools

The edge function `supabase/functions/google-search-console/index.ts` already implements `list_sitemaps`, `submit_sitemap`, and `delete_sitemap` — they're just not wired into the chat tool registry. No new API code needed.

In `supabase/functions/chat/index.ts`, add three tools alongside the existing `gsc_*` definitions:

- **`gsc_list_sitemaps`** — `{ site_url: string }` → `list_sitemaps`
- **`gsc_submit_sitemap`** — `{ site_url: string, sitemap_url: string }` → `submit_sitemap`. Tool description explicitly says to use the full sitemap URL (e.g. `https://sweetblissmedia.com/sitemap.xml`) and that `sc-domain:` properties accept the same `site_url` they were listed under.
- **`gsc_delete_sitemap`** — `{ site_url: string, sitemap_url: string }` → `delete_sitemap`

For each tool, update the parallel registries already present in the file:
- Tool schema list (near line 2538, with the other `gsc_*` defs)
- Dispatch routing map (near line 3378)
- `executeToolCall` switch cases (near line 5361) — each maps args to the edge function envelope `{ action, params }` and surfaces `{ success, result }` with a human-readable confirmation
- Tool→function name map (line 7689)
- Activity label map (line 8110): "Listing sitemaps" / "Submitting sitemap to Google" / "Removing sitemap"
- `gsc_` prefix is already in the SEO domain gate (line 10562), no change needed

Update the SEO system-prompt block (around lines 7169–7172) to mention the new sitemap tools so the model knows to call `gsc_submit_sitemap` instead of inventing a name.

## 2. Remove Search Atlas

Search Atlas exists across both backend and frontend:

**Backend:**
- Delete `supabase/functions/search-atlas/` (whole directory)
- Delete `supabase/functions/_shared/integrations/search-atlas.ts`
- Remove the `searchAtlasIntegration` import and array entry from `supabase/functions/_shared/integrations/index.ts`
- In `supabase/functions/chat/index.ts`, remove any `search_atlas*` tool definitions, dispatch entries, switch cases, activity labels, and prompt references (sweep all occurrences)

**Frontend:**
- Remove the Search Atlas entry from `src/integrations/registry.ts`
- Remove the `/integrations/search-atlas` route and the `SearchAtlasDetail` import from `src/App.tsx`
- Delete `src/pages/integrations/SearchAtlasDetail.tsx`
- Leave `src/integrations/supabase/types.ts` alone (auto-generated)

**Memory:** No memory file references Search Atlas, so nothing to clean there.

## 3. Verification

- Deploy `chat` (and confirm `google-search-console` is still healthy).
- From chat: "submit https://sweetblissmedia.com/sitemap.xml to sc-domain:sweetblissmedia.com" → should call `gsc_submit_sitemap` and return success.
- Visit `/integrations` and confirm Search Atlas card is gone and no broken route remains.

## Technical notes

- The GSC edge function expects the `siteUrl` in the URL path to be encoded — handler already does this. Chat tool just passes `site_url` through `params`.
- `submit_sitemap` is a PUT in the underlying API; the edge function already wraps it as a POST-style action. No upstream changes.
- Test mode / live actions are permitted per project policy, so no extra confirm gate is added for `gsc_delete_sitemap` beyond the model's normal list-confirm-act behavior.
