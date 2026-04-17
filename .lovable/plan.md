
User wants the two GHL improvements: (1) multi-account resolver and (2) smart_search tool. Let me check current GHL credential resolution to plan accurately.

Key facts from memory + audit:
- Per-user creds live in `integration_connections` (metadata.api_key, metadata.location_id)
- Currently single location per user — no sub-account concept yet
- Maton resolver pattern: explicit → contextual → inferred (from `identity-context-resolution-rules`)
- Chat function calls GHL via `callGHL(action, params)` helper

## Plan — GHL multi-account resolver + smart_search

### Part A — Multi-account (sub-account) resolver

**Data model change**
Today `integration_connections` for `gohighlevel` stores one `{api_key, location_id}` pair. Add support for an array of sub-accounts in `metadata.sub_accounts`:
```
metadata: {
  api_key: "...",                    // agency or default key
  location_id: "abc",                // default/primary
  sub_accounts: [
    { id: "abc", name: "Main Biz", api_key?: "..." },
    { id: "xyz", name: "Client B", api_key?: "..." }
  ]
}
```
Per-sub-account `api_key` is optional — falls back to top-level key (covers agency-key-with-many-locations + per-location-key both).

**Backend resolver (in `chat/index.ts` GHL helper)**
New `resolveGHLContext({ userId, hint })`:
1. **Explicit** — if tool args include `location_id`, use it (validate it exists in sub_accounts list)
2. **Contextual** — if hint matches a sub-account name (fuzzy: "main biz", "client b"), use it
3. **Inferred** — if only one sub-account, use it; else use `location_id` (default)
4. **Ambiguous** — return structured error listing available accounts so the model can ask the user (List-Confirm-Act protocol)

Every `callGHL` call goes through resolver → injects correct `location_id` + auth header.

**Tool surface**
- Add `location_id` (optional) param to ~all GHL tools so the model can pass it when known
- Add `ghl_list_sub_accounts` tool (lists configured sub-accounts so model can pick)
- Add `ghl_set_active_sub_account` (session-scoped switch — stored in conversation context, not DB)

**Frontend (`GoHighLevelDetail.tsx`)**
The page already renders a `subAccounts` UI but it's stubbed to a single "default". Wire it up:
- "Add sub-account" button → modal: name + location_id + optional api_key → `upsertIntegrationConnection` with full sub_accounts array
- Edit/remove existing sub-accounts
- "Active" pill marks the default (stored as `location_id` at top level)

### Part B — `ghl_smart_search` tool

Single tool that fans out across contacts + opportunities + conversations + appointments + invoices in parallel and returns a unified ranked result.

**Tool def**
```
ghl_smart_search(query: string, types?: string[], limit?: number, location_id?: string)
```
- `types` defaults to `["contacts","opportunities","conversations","appointments"]`
- `limit` per-type, default 5

**Implementation in `chat/index.ts`**
Single handler that runs `Promise.allSettled` of the existing GHL search/list endpoints with the query, normalizes results into a uniform shape:
```
{ type, id, title, subtitle, snippet, url_hint, score, raw }
```
Returns `{ results: [...], errors: [{type, message}] }` so partial failures don't break the whole thing (per `error-reporting-policy`).

**Why this matters**
Current pattern forces the model to call `ghl_list_contacts` + `ghl_list_opportunities` + `ghl_list_conversations` separately when user asks "find anything about John Smith" — 3 round trips. Smart search collapses to 1.

### Files touched
- `supabase/functions/chat/index.ts` — add resolver helper, inject location into all GHL tools, add `ghl_list_sub_accounts`, `ghl_set_active_sub_account`, `ghl_smart_search`
- `src/pages/integrations/GoHighLevelDetail.tsx` — sub-account CRUD UI
- `src/services/integrationConnectionService.ts` — helper to upsert sub_accounts array (if not already supported)
- No DB migration needed — `metadata` is JSONB

### Verify after
1. Add 2 sub-accounts in `/integrations/gohighlevel`, set one as default
2. Ask "list contacts" → uses default
3. Ask "list contacts in Client B" → resolver picks Client B
4. Ask "search GHL for Sarah" → smart_search returns contacts + opps + convos in one call
5. Remove a sub-account → chat falls back cleanly

### Recommendation
Ship in this order: smart_search first (zero schema risk, immediate UX win), then multi-account resolver (needs the UI work). Or both in one pass — your call.
