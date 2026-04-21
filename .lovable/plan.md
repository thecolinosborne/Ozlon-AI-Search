

## Add API Key + Channel ID Inputs to YouTube Detail Page

The YouTube detail page currently lacks the masked, validated input fields for the YouTube Data API key and Channel ID that other integration pages have. Add them with the same `ApiKeyInput` pattern used elsewhere (ClickUp, GHL), with live validation against the YouTube Data API and persistence into `integration_connections.metadata`.

### Changes

**File: `src/pages/integrations/YouTubeDetail.tsx`**
- Add a "YouTube Data API & Channel" section using two `ApiKeyInput` components:
  - **YouTube Data API Key** — saves into `metadata.youtube_api_key`
  - **Channel ID** — saves into `metadata.channel_id` (with same masked/configured/edit pattern)
- On save:
  1. Validate the API key by calling `https://www.googleapis.com/youtube/v3/channels?part=id&mine=true&key=…` (or `id=<channel_id>` if both present).
  2. On success → `upsertIntegrationConnection("youtube", { youtube_api_key, channel_id }, "api_key_plus_oauth")` and toast "API key validated".
  3. On failure → toast the error and return `false` from the save handler so the input stays in edit mode.
- Hydrate `configured` state and `maskedHint` (last 4 chars) from the existing `integration_connections` row on mount, alongside the OAuth status that's already shown.
- Place the new section directly above the existing "Channel Settings" / connection card so it reads top-to-bottom: API Key → Channel → OAuth status.

**File: `supabase/functions/youtube/index.ts`** (small additive change)
- When resolving credentials for native YouTube Data API calls (search, list videos, etc.), prefer `metadata.youtube_api_key` from the user's connection over the env-var `YOUTUBE_API_KEY` fallback. OAuth-scoped calls (`mine=true`, uploads) continue to use the OAuth bearer token via `_shared/google-token.ts`.

### Out of scope

- No changes to OAuth flow, Google Workspace scopes, or the `_shared/google-token.ts` helper.
- No new tables or migrations — `metadata` jsonb already holds these values per existing pattern (`SECRET_METADATA_KEYS` in `integrationConnectionService.ts` will mirror `youtube_api_key` into the vault if we add it to the map; otherwise it stays in metadata only). I'll add `youtube_api_key` to the vault mirror map for parity.
- ClickUp redundant "Sync Now" removal (separate prior request) — not bundled here unless you want it.

### Technical notes

- Validation endpoint requires only the API key for public-data calls; `mine=true` requires OAuth, so the validator uses a lightweight public call: `GET /youtube/v3/videos?part=id&chart=mostPopular&maxResults=1&key=…` which returns 200 on a valid key and 400 on invalid.
- `ApiKeyInput` already handles masked display, eye toggle, and edit/cancel states — no new UI primitives needed.
- Channel ID is not a secret but reusing `ApiKeyInput` keeps visual parity; pass `type="text"` semantics by leaving `visible` toggle (harmless for non-secret).

