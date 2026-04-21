

## Fix: YouTube API Key & Channel ID Not Showing as Configured

### Root cause

There is exactly **one** `integration_connections` row per `(user_id, provider="youtube")` (enforced by unique index). That single row holds *both* the OAuth tokens *and* the API key in `metadata`.

- The `connect` action (saving API key + Channel ID) correctly **updates** that single row's `metadata.api_key`, `metadata.api_key_masked`, and `external_account_id` (channel ID) — but it preserves the existing `auth_type` (which is `"oauth2"` because you authorized OAuth previously).
- The `get_connection` action reads the API key state with `.eq("auth_type", "api_key")` — which **excludes** your row because its `auth_type` is `"oauth2"`. So the UI gets `connection: null` and shows the inputs as not configured, even though your key + channel ID are saved.

This also blocks update flows: when `ApiKeyInput` shows "Configured ✓", clicking **Update** would let you paste a new key — but you never see "Configured", so the saved values appear lost.

### Fix (1 file)

**`supabase/functions/youtube/index.ts` — `get_connection` action (lines ~221–287)**

Stop filtering by `auth_type`. There's only one row per provider; read it directly and derive both states from a single fetch:

1. Replace the two filtered queries with **one** query: `.eq("user_id", userId).eq("provider", "youtube").maybeSingle()`.
2. Build `apiKeyResponse` whenever `metadata.api_key` is present (regardless of `auth_type`). The masked hint comes from `metadata.api_key_masked`, channel ID from `external_account_id`, label from `external_account_label`.
3. Build `oauthStatus` from the same row using `metadata.access_token` / `metadata.refresh_token` / `metadata.expires_at` (regardless of `auth_type`). Keep the existing refresh-on-expired logic.
4. Set `apiKeyResponse.status = "connected"` whenever a valid `metadata.api_key` exists.

**`connect` action (lines ~289–454) — small hardening**

When updating an existing row whose `auth_type` is `oauth2`, ALSO write a clear flag so future reads aren't ambiguous. Two tiny touches:
- Always set `metadata.api_key_masked` (already done).
- After UPDATE, if the row's `auth_type` was `oauth2`, leave it as-is (OAuth still works) — no schema/auth_type change needed once the read side is fixed.

### What you'll see after the fix

- Reload `/integrations/youtube` → "YouTube Data API Key" shows **Configured ✓** with the masked tail (`***xxxx`).
- "Channel ID" shows **Configured ✓** with `UCxx…xxxx`.
- Clicking **Update** on either reveals an input prefilled-empty so you can paste a new value; saving runs the same `connect` action which validates with Google (`/videos?part=snippet&id=…`) before overwriting.
- The same one row continues to power OAuth for all 9 sister Google services — no migration, no data loss.

### Out of scope

- No DB migration. No schema changes. No frontend changes (the inputs already render correctly when `apiKeyConfigured` and `channelId` come back true).
- No changes to OAuth flow, sync logic, upload form, or sister Google service pages.
- The `auth_type` column stays as a soft hint only; the source of truth is `metadata.api_key` + `metadata.access_token`.

### Technical notes

- The unique index on `(user_id, provider)` guarantees `maybeSingle()` is safe.
- Existing rows already have `metadata.api_key` and `metadata.api_key_masked` populated from your earlier saves — no backfill needed; the fix is purely on the read path.
- `validateApiKey` continues to use the cheap 1-quota `/videos?id=dQw4w9WgXcQ` call, and channel-ID validation continues to use `/channels?part=snippet&id=…`, both surfacing Google's specific error reasons (`API_KEY_INVALID`, `SERVICE_DISABLED`, etc.) on failure.

