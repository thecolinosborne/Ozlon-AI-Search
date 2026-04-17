
User picked **Option A** — Vault-first with metadata fallback. Surgical, low risk, function-by-function.

## Phase 4: Cutover edge function reads (Option A)

For each integration edge function, add a vault-first credential resolver: try `get_user_secret` first, fall back to `metadata.api_key` if the vault returns null. No metadata removal, no breakage if vault row is missing.

### Pattern (applied per function)

In each function's existing `resolve*Key` (or equivalent) helper, before the current `metadata.api_key` lookup, insert:

```ts
// 1. Look up connection_id for this user+provider
// 2. Call admin.rpc("get_user_secret", { _connection_id, _user_id, _secret_name: "api_key", _encryption_key: bytesToHex(rawKeyBytes) })
// 3. If non-null → use it, log "vault_read" to credential_audit_log
// 4. If null → fall through to existing metadata.api_key path (legacy)
// 5. If env var fallback exists → keep as last resort
```

Key handling mirrors `vault-store`: read `VAULT_ENCRYPTION_KEY` as raw 32-byte UTF-8, convert to `\x...` hex bytea for the RPC.

### Rollout order

1. **`youtube`** — already dual-writes, vault row exists, safest first cutover
2. **`descript`** — server-side connect path, needs same dual-write patch as youtube before flip *(or accept metadata-only for now since you have no vault row)*
3. **`clickup`** — uses `upsertIntegrationConnection` so vault dual-writes on next save; flip read after re-save
4. **`gohighlevel`** — same as clickup
5. **`higgsfield`** — same as clickup

After step 1, you re-test YouTube end-to-end. If green, we proceed down the list. Each step is one function + one re-save + one verify.

### Out of scope (still)
- No metadata removal
- No `descript` server-side dual-write patch yet (do only if you want descript on the vault before flip)
- No key rotation
- Keep `debug_roundtrip` action in `vault-store` as a diagnostic

### Files touched (Step 1 only — youtube cutover)
- `supabase/functions/youtube/index.ts` — add vault-first lookup in the existing key resolver, fallback to current metadata path

Approve and I'll execute Step 1 (youtube read cutover) in default mode, then we test before moving to the next function.
