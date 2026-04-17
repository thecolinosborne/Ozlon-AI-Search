
## Step 3: `clickup` cutover (read-side flip + client cleanup)

ClickUp already saves through `upsertIntegrationConnection`, so the vault dual-write is already happening on save. Only the read path + client override needs fixing.

### 1. `supabase/functions/clickup/index.ts` — patch `resolveClickUpToken`

Replace the existing function to mirror the YouTube/Descript pattern:

1. `tokenOverride` (explicit param, kept for back-compat with webhook callbacks)
2. **NEW:** vault read via `get_user_secret` RPC (when authed user + connection exists), with `vault_read` audit log
3. `metadata.api_key` (legacy fallback, current behavior)
4. `getToken()` env var fallback (last resort)

Add helpers at top of file (mirroring vault-store):
- `keyToBytes(raw)` → 32-byte UTF-8 key
- `bytesToHex(bytes)` → `\x...` bytea literal
- `tryVaultRead(adminClient, connectionId, userId)` → calls `get_user_secret` RPC, returns plaintext or null, inserts `vault_read` row into `credential_audit_log`

### 2. `src/pages/integrations/ClickUpDetail.tsx` — stop sending `apiToken` in payload

The current `getAuthParams()` returns `{ apiToken: storedSettings.apiToken }`, which short-circuits the new vault resolver before it can run (same bug we just hit on Descript).

Change `getAuthParams()` to return `{}` so the edge function always resolves server-side via the vault-first path. Keep `storedSettings.apiToken` in local state only for the masked-hint display (`••••${last4}`) — do NOT send it on the wire.

### Verification (after deploy)

1. You re-save your ClickUp API token in `/integrations/clickup` → confirms `vault_store` audit row + `last4` in `integration_credentials`.
2. You hit "Connect" or any ClickUp action → confirms `vault_read` audit row + `last_used_at` advances.
3. I'll query both via `psql` and report green/yellow/red.

### Files touched
- `supabase/functions/clickup/index.ts` — vault helpers + `resolveClickUpToken` flip
- `src/pages/integrations/ClickUpDetail.tsx` — drop `apiToken` from outgoing payload

### Out of scope
- No metadata removal yet (legacy fallback stays for safety)
- No changes to webhook callback path (it already passes `tokenOverride` from stored config when needed)
- No changes to higgsfield / ghl / chat function
