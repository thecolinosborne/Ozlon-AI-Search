
User is mid-flow on the integration vault cutover. Higgsfield edge function was just patched server-side, but the frontend (`HiggsFieldDetail.tsx`) is still writing the api_key/app_id into `metadata` only — meaning the new vault resolver has nothing to read until the page is patched too. That's the next logical step.

After Higgsfield is fully cut over, the remaining integration is GoHighLevel (still env/metadata only, no vault). Then we can clean up legacy `metadata.api_key` rows for the now-vaulted providers.

## Recommended next step: finish Higgsfield (frontend) + verify

### 1. Patch `src/pages/integrations/HiggsFieldDetail.tsx`
- On save, call the `vault-store` edge function twice (once with `secret_name: "api_key"`, once with `secret_name: "app_id"`) — same pattern ClickUp/Descript use.
- Keep writing a non-secret marker into `metadata` (e.g. `last4`, `app_id_last4`, `connected_at`) so the UI can show connection state without exposing secrets.
- Stop writing the raw `api_key` / `app_id` into `metadata`.
- Also switch any test/validation calls to `supabase.functions.invoke("higgsfield", ...)` so the user JWT is forwarded (same fix we just applied to ClickUp).

### 2. Verify end-to-end
- User saves Higgsfield credentials in `/integrations/higgsfield`.
- Query `credential_audit_log` for two new `vault_store` rows (`api_key` + `app_id`) for provider `higgsfield`.
- User clicks Test Connection → query for a `vault_read` row.
- Confirm `integration_credentials.last_used_at` advances.

### Files touched
- `src/pages/integrations/HiggsFieldDetail.tsx` — vault dual-write + invoke() switch

### Then (separate follow-ups, your call which order)
- **GHL cutover** — apply the same vault-first resolver to `supabase/functions/gohighlevel/index.ts` and patch `GoHighLevelDetail.tsx` to dual-write `api_key` + `location_id` to vault.
- **Legacy cleanup** — once all four providers are vault-live and verified, drop `metadata.api_key` from `clickup` / `descript` / `higgsfield` rows and remove the metadata fallback branch from each edge function.

### Out of scope right now
- No changes to chat function, webhook paths, or other integrations
- No removal of env var fallbacks yet (kept as last-resort safety net)
