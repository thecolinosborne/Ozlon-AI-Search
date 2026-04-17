
The previous turn removed `apiKey` from the client payload so the edge function would resolve from the vault. To confirm "is it good?" I need to verify the round-trip actually happened after that change. Querying `credential_audit_log` for descript `vault_read` entries and `integration_credentials.last_used_at` is read-only — fits this mode.

Plan:
1. Query `credential_audit_log` for any `vault_read` rows where `provider = 'descript'` ordered by newest first.
2. Query `integration_credentials` joined to `integration_connections` for the descript row to check `last_used_at` and `last4`.
3. Report:
   - **Green** if a `vault_read` exists newer than the most recent `vault_store` AND `last_used_at` is non-null and recent → cutover working end-to-end.
   - **Yellow** if vault row exists but no `vault_read` yet → user hasn't re-tested since the client patch; ask them to hit Test Connection once more.
   - **Red** if errors appear in descript edge logs after the patch → diagnose.

No code changes proposed — this is a verification step only.
