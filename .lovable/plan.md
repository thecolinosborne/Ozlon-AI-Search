

## Wire Up Search Atlas — Backend, Frontend, Edge Function, Chat Tools

Full integration mirroring the existing ClickUp/GHL pattern: per-user encrypted API key, dedicated edge function, integration card + detail page, and chat-callable tools across all 4 capability areas.

### 1. Database (one migration)

Add `search_atlas` rows handled by the existing `integration_connections` + `integration_credentials` tables (already RLS-protected, vault-encrypted). No schema changes needed — provider just becomes `"search_atlas"`. The existing `upsertIntegrationConnection()` mirrors the API key into the encrypted vault automatically.

Add an optional cache table for sync runs:

```text
search_atlas_snapshots (id, user_id, kind, domain, payload jsonb, fetched_at)
  RLS: user can only read/write their own rows
```

This lets Sync Now persist the latest audit/keyword/backlink/rank pulls so the chat tools and Brain page can read recent data without re-hitting the API every turn.

### 2. New edge function: `supabase/functions/search-atlas/index.ts`

Single-function gateway (mirrors `clickup/index.ts` shape). Resolves the user's API key in the standard order: vault → metadata → env fallback (`SEARCH_ATLAS_API_KEY` if you ever want a workspace default). Bearer-auth against `https://api.searchatlas.com`.

**Actions exposed:**

| Action | Purpose |
|---|---|
| `connect` / `test_connection` | Validate the token by calling a low-cost endpoint (e.g. `/v2/projects/`) and report account info. |
| `list_projects` | Pull rank-tracking projects so the Detail page can show a picker. |
| `audit_site` | Site Audit summary + crawl issues for a domain. |
| `site_explorer` | Domain overview metrics (traffic, top pages). |
| `keyword_research` | Volume / KD / CPC / SERP intent for a keyword or list. |
| `serp_snapshot` | Live SERP results for a keyword + country. |
| `backlinks_overview` | Referring domains, total backlinks, anchor profile. |
| `backlinks_list` | Paginated backlink rows (new/lost/active). |
| `rank_tracker_keywords` | Tracked keyword positions for a project. |
| `sync_now` | Runs the 4 read calls above for the user's selected domain/project, writes results into `search_atlas_snapshots`, logs to `integration_sync_runs`. |

Auth: same JWT-resolve pattern as ClickUp — `verify_jwt = false` in `config.toml`, function validates the user from the `Authorization` header, then loads their key from the vault. Errors return structured `{ error, status, detail }` (per error-reporting policy — never swallow).

### 3. Frontend

**Add to `src/pages/Integrations.tsx`** — one new entry under a new `"seo"` category (or reuse `"productivity"`):

```text
{ id: "search-atlas", name: "Search Atlas", icon: Search,
  description: "Site audit, keyword research, backlinks, and rank tracking.",
  path: "/integrations/search-atlas", category: "seo" }
```

Add `search-atlas: "search_atlas"` to `PROVIDER_BY_ID`. Add a `"SEO"` filter pill.

**New page `src/pages/integrations/SearchAtlasDetail.tsx`** — modeled on `ClickUpDetail.tsx`. Includes:

- `ApiKeyInput` for the bearer token → `upsertIntegrationConnection("search_atlas", { api_key })` → vault dual-write.
- Connect / Test / Disconnect buttons.
- Default domain input + project picker (populated from `list_projects`).
- Sync Now button → `search-atlas/sync_now` → toast + `SyncRunsList` refresh.
- Recent snapshots panel showing the latest audit score, top 5 keywords, and backlink count for the selected domain.

**Wire route** in `src/App.tsx` next to the other `/integrations/...` routes.

### 4. Chat tool surface (`supabase/functions/chat/index.ts`)

Register 8 new tools, all routed to the new edge function, following the existing GSC/GA pattern:

- `searchatlas_audit_site` — `{ domain }`
- `searchatlas_site_explorer` — `{ domain }`
- `searchatlas_keyword_research` — `{ keyword, country?, limit? }`
- `searchatlas_serp_snapshot` — `{ keyword, country? }`
- `searchatlas_backlinks_overview` — `{ domain }`
- `searchatlas_backlinks_list` — `{ domain, type?: "new"|"lost"|"active", limit? }`
- `searchatlas_list_projects` — `{}`
- `searchatlas_rank_tracker` — `{ projectId }`

Add entries to `toolRoutingMap`, `labelMap`, and `domainMap` so they appear in the live "Working" strip and Brain routing log. Add a `SEARCH ATLAS PROTOCOL` paragraph to the system prompt:

> When the user asks about SEO performance, audits, keyword opportunities, backlinks, or rankings, prefer Search Atlas tools. Cross-reference with `gsc_*` / `ga4_*` when the user wants real traffic data alongside Search Atlas estimates. Never claim you cannot pull SEO data — you have full Search Atlas access.

### 5. Config + secrets

- `supabase/config.toml`: add `[functions.search-atlas]` with `verify_jwt = false`.
- No new secrets required up front (per-user vault). If you want a workspace fallback later, add `SEARCH_ATLAS_API_KEY` via the secrets tool — not needed for v1.

### Files touched

- **New**: `supabase/functions/search-atlas/index.ts`, `src/pages/integrations/SearchAtlasDetail.tsx`, one migration for `search_atlas_snapshots`.
- **Edited**: `src/pages/Integrations.tsx` (new card + provider map + SEO filter), `src/App.tsx` (route), `supabase/functions/chat/index.ts` (8 tools + protocol prompt + maps), `supabase/config.toml` (verify_jwt entry).

### Out of scope

- No write actions to Search Atlas (create projects, queue audits) in v1 — read-only sync first, additive write tools later.
- No new connectors or OAuth flows — single bearer token only.
- No changes to Gmail, GSC, GA4, or any other existing integration.

### Note on Search Atlas API specifics

Their public docs aren't reachable from this sandbox. The edge function will be built against the standard Search Atlas v2 REST shape (`Authorization: Bearer <token>`, `https://api.searchatlas.com/api/v2/...`). If specific endpoint paths differ for your account tier, the action handlers are isolated and easy to adjust once you confirm the exact paths from your dashboard's API section — the rest of the wiring (vault, UI, chat tools, sync runs) is endpoint-agnostic.

