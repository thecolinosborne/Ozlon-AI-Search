
User picked Step 2 — descript. Per the rollout plan, descript needs the full two-part patch (save dual-write + read flip) since it bypasses `upsertIntegrationConnection`. I already have the full descript function source above. Pattern mirrors what was done to youtube.

## Step 2: `descript` cutover (full patch)

Apply the same two-part treatment YouTube got: save-side dual-write into the vault, plus vault-first read with metadata fallback.

### Changes to `supabase/functions/descript/index.ts`

1. **Add helpers** (mirrored from `youtube/index.ts`):
   - `keyToBytes(raw)` → 32-byte UTF-8 key
   - `bytesToHex(bytes)` → `\x...` bytea literal
   - `tryVaultRead(adminClient, connectionId, userId)` → calls `get_user_secret` RPC, returns plaintext or null, logs `vault_read` to `credential_audit_log` on hit

2. **Patch `resolveDescriptKey`** — vault-first order:
   1. `paramApiKey` (unchanged, explicit override)
   2. **NEW:** vault read via `tryVaultRead` (when authed user + connection exists)
   3. `metadata.api_key` (legacy fallback, unchanged)
   4. `DESCRIPT_API_KEY` env var (last resort, unchanged)

3. **Add server-side connect/save action** so descript saves dual-write into the vault going forward. Add a new `action: "save_api_key"` case that:
   - Validates the user
   - Upserts `integration_connections` row (mirroring `upsertIntegrationConnection`)
   - Calls `store_user_secret` RPC with the raw key + 32-byte VAULT_ENCRYPTION_KEY
   - Logs `vault_store` to `credential_audit_log`
   - Returns `{ success, last4 }`

   *(If descript already has a save flow through the client `upsertIntegrationConnection` service, the dual-write is already happening on the client side. I'll verify which path the Descript detail page uses before writing — if it goes through the shared service, I skip the new server action and only patch the resolver.)*

### Verification step (after deploy)

You re-save your Descript API key in `/integrations/descript`, then run any Descript action (e.g. `test_connection`). I check:
- `integration_credentials` row exists for descript connection
- `credential_audit_log` shows `vault_store` then `vault_read` for that connection

### Files touched
- `supabase/functions/descript/index.ts` — vault helpers + resolver flip + (conditional) save action
- Possibly `src/pages/integrations/DescriptDetail.tsx` — only if the current save path needs to be redirected through the new edge action; otherwise untouched

### Out of scope (unchanged)
- No metadata removal
- No changes to clickup / ghl / higgsfield yet
- `debug_roundtrip` stays
