---
name: Per-user integration credential isolation
description: All integration API keys stored per-user in integration_connections table, edge functions resolve from JWT user first
type: feature
---
All integration credentials (ClickUp, GHL, Descript, Higgsfield, Google OAuth) are stored per-user in the `integration_connections` table with RLS protection (`auth.uid() = user_id`).

**Resolution order in edge functions:**
1. Explicit param from request body (for backward compat)
2. Per-user lookup: extract user from JWT → query `integration_connections` where `user_id + provider + status='connected'` → read `metadata.api_key` (or OAuth tokens)
3. Env var fallback (for webhooks without user context, e.g. ClickUp webhook callbacks)

**Frontend:** All detail pages (ClickUp, GHL, Descript, Higgsfield, YouTube/Google) call `upsertIntegrationConnection()` from `src/services/integrationConnectionService.ts` when saving keys.

**Chat function:** Resolves GHL keys from the authenticated user's `integration_connections` before falling back to env vars. Google services use the user's OAuth token via the shared `_shared/google-token.ts` helper. The `getAvailableTools()` function accepts a `hasGHLOverride` param.

**Security:** New users see empty integrations, must enter their own keys. Your keys are inaccessible to other users via RLS.
