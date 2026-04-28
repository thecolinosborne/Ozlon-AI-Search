## GoHighLevel — Scope-Aware Sub-Account Connection

**The model (revised per your direction):**

User pastes one **Private Integration API token** + its **Location ID** per sub-account. On save, Ozlon calls GHL to introspect what that token can actually do (based on the scopes the user checked when creating the token in GHL), stores the scope list, and uses it to:

1. Mark which capabilities are live for that sub-account (custom fields, contacts, opportunities, calendars, social planner, etc.)
2. Hide/disable AI tools that the token isn't scoped for (so the AI doesn't try `ghl_create_custom_field` on a token without `customFields.write`)
3. Show the user a clean per-sub-account capability matrix in the UI

This is the same pattern as Slack/Google OAuth — token + scopes drive what's enabled.

### How scope discovery works

GHL Private Integration tokens are JWTs. The granted scopes are embedded in the token payload (`oauthMeta.scopes` claim) and also returned by `GET /oauth/installedLocations` and the token introspection endpoint. On save, Ozlon will:

1. Decode the JWT payload (no API call needed) → extract `oauthMeta.scopes` array.
2. Cross-check by hitting `GET /locations/{locationId}` with the token → confirms the token actually has access to that specific location.
3. If the location call returns 403, surface a clear error: *"Token doesn't include this location. Re-create the token in GHL with the correct location selected."*
4. Store the scope list on the sub-account record.

### What gets built

**1. UI: Sub-account row enhancements (`GoHighLevelDetail.tsx`)**
- Existing fields stay: Label, Location ID, API Key.
- New on save: "Verify & Sync Scopes" runs automatically — shows a spinner, then displays granted scopes as small chips (e.g. `contacts.write`, `customFields.readonly`, `opportunities.write`).
- New "Re-sync scopes" button on each row for when the user updates their token in GHL.
- Capability badges: green dot for capabilities the token supports, grey for ones it doesn't. Hover shows the missing scope.

**2. New edge function action: `gohighlevel/verify_token`**
- Input: `{ apiKey, locationId }`
- Decodes JWT, calls `GET /locations/{locationId}`, returns `{ ok, scopes: string[], locationName, companyId, errors? }`.
- Frontend calls this on save and on "Re-sync".

**3. Storage**
- Each entry in `integration_connections.metadata.sub_accounts[]` gains:
  ```
  { label, location_id, api_key, scopes: string[], company_id, location_name, last_verified_at }
  ```
- No DB migration needed — `sub_accounts` is already JSON.

**4. Scope-gated tool registration (chat function)**
- When the chat function loads the active sub-account's credentials, it also reads its `scopes`.
- The GHL tool manifest gets a `requiredScopes: string[]` field per tool (e.g. `ghl_create_custom_field` → `["customFields.write"]`).
- `getAvailableTools()` filters out any GHL tool whose required scopes aren't in the active sub-account's scope list.
- The AI literally can't call a tool it doesn't have permission for → no more silent 403s.

**5. Scope reference map (one new file)**
- `supabase/functions/_shared/integrations/ghl-scopes.ts` — maps every GHL tool name to the GHL OAuth scopes it needs. Used by both the chat tool filter and the UI capability badges.
- Initial coverage: contacts, custom fields, custom values, opportunities, calendars, conversations, locations, social planner, products, payments, workflows, surveys, forms, blogs, businesses, companies. (~20 scope strings.)

### User flow (end state)

1. User goes to Integrations → GoHighLevel → **Add Sub-Account**.
2. Enters Label ("Daddy Stroller Social Club"), Location ID, Private Integration API token.
3. Clicks Save → Ozlon verifies the token, shows: *"Connected — 14 scopes detected"* and renders capability badges.
4. The active sub-account selector (existing) still works — pick which one is live for the chat.
5. AI tools available in chat are auto-limited to what the active sub-account's scopes permit. If a tool is missing, the AI tells the user *"This sub-account's token doesn't include `customFields.write`. Re-create the token in GHL with that scope to unlock this."*

### Files touched

- `src/pages/integrations/GoHighLevelDetail.tsx` — verify-on-save flow, scope chips, capability badges, re-sync button.
- `supabase/functions/gohighlevel/index.ts` — add `verify_token` action; existing `_shared/integrations/gohighlevel.ts` tool manifest gains `requiredScopes` per tool.
- `supabase/functions/_shared/integrations/ghl-scopes.ts` — new file: tool→scopes map + `filterToolsByScopes()` helper.
- `supabase/functions/chat/index.ts` — when resolving GHL credentials, also pull `scopes` and pass to `getAvailableTools()` for scope-based filtering.

### Out of scope

- Agency-level auto-discovery (you've explicitly chosen the per-sub-account token model — simpler, scoped, scalable).
- No DB schema migration (uses existing JSON metadata column).
- No changes to the custom-fields tool family already in the previous plan — it just becomes scope-gated automatically.

### Acceptance check

- Add a sub-account with a token missing `customFields.write` → UI shows the badge as grey; AI cannot call `ghl_create_custom_field` and explains why.
- Add a sub-account with full scopes → all GHL tools are available; chat can list/create/update custom fields end-to-end.
- Re-paste a token after expanding scopes in GHL → "Re-sync scopes" updates the chip list without recreating the row.
- Wrong location ID for the token → save fails with a specific actionable error, no silent acceptance.
