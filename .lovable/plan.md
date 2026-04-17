
User just finished Phase 2 (vault-store deployed with raw-bytes key fix). Logical next steps fall into verify → backfill → cutover.

Phase 3 plan: verify the dual-write actually worked, backfill remaining keys, then (separately) flip edge functions to read from the vault.

Keep it surgical. Don't touch reads yet — they explicitly said "do not touch any edge function reads" until vault is proven populated.

## What's next — Phase 3: Verify + Backfill

We just got the vault-store function working with the raw-bytes encryption key. Three things left before we can safely flip the edge functions over to read from the encrypted vault:

### Step 1 — Verify the vault works end-to-end (5 min)
Re-save your YouTube API key from the Integrations Hub UI, then confirm:
- A row exists in `integration_credentials` for that connection
- `secret_ciphertext` is non-null (encrypted blob)
- `last4` matches the last 4 chars of your real key
- `credential_audit_log` shows a `vault_store` entry

If any of those fail, we fix before moving on.

### Step 2 — Backfill your other connected integrations
For each connection that already has a plaintext `metadata.api_key` (ClickUp, GHL, Higgsfield, Descript, etc.), call `vault-store` once to mirror it into `integration_credentials`. Done from your authenticated session so RLS + JWT validation hold. After this, every connection has both:
- legacy plaintext in `metadata` (still used by edge functions)
- encrypted copy in the vault (unused, ready)

### Step 3 — Decision point: when to cut over reads
Once backfill is verified, we have two options for flipping edge functions to read from the vault. I'll lay them out then so you can choose — not doing it in this phase.

### Out of scope for Phase 3
- No edge function read changes (youtube, clickup, ghl, etc. keep reading metadata)
- No removal of plaintext metadata
- No key rotation

### Files touched
- None modified — Step 1 is pure verification (SQL queries + UI re-save)
- Step 2 is a one-shot backfill script run via the already-deployed `vault-store` function, no code changes

After you approve, I'll start with Step 1 verification.
