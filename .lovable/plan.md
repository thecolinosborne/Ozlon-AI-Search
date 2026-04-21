

## Next Steps — Prioritized

Based on a fresh scan (security scanner + edge logs + integration_connections + memory), here's what's outstanding. No critical breakage — these are the next meaningful improvements.

### Priority 1 — Security hardening (3 errors from scanner)

**1.1 Lock down `integration_credentials` writes**
Table has SELECT but no INSERT/UPDATE/DELETE RLS. A user could theoretically insert rows with arbitrary `user_id`. Add:
- `INSERT WITH CHECK (auth.uid() = user_id)`
- `UPDATE USING (auth.uid() = user_id)`
- `DELETE USING (auth.uid() = user_id)`

**1.2 Lock down `credential_audit_log`**
No INSERT WITH CHECK — audit records can be forged. Add:
- `INSERT WITH CHECK (auth.uid() = user_id)`
- Restrict DELETE to service_role only

**1.3 Realtime channel authorization**
`chat_sessions`, `work_tasks`, `artifacts`, `task_events` are published to Realtime but `realtime.messages` has no RLS. Any authed user could subscribe to any topic. Add a policy on `realtime.messages` restricting topic subscription by `auth.uid()`.

### Priority 2 — Storage bucket privacy (2 warnings)

**2.1 `generated-images` and `generated-videos` are public**
Last round we locked down *listing* but the buckets are still `public=true`, so direct URLs leak globally. Two options:
- Switch buckets to private + signed URLs (fully secure)
- Keep public if content is non-sensitive (document the decision)

I'd recommend **private + signed URLs** since these are user-generated.

### Priority 3 — Data hygiene

**3.1 Duplicate integration rows**
DB shows duplicate `connected` rows for `clickup` and `youtube` for the same user. Dedupe + add a unique constraint on `(user_id, provider)` to prevent recurrence.

**3.2 No sync runs ever recorded**
All `last_sync_at` columns are null — meaning the YouTube/ClickUp sync workflows defined in the V1 contract have never executed. Either:
- Wire up the actual sync triggers (button → edge function → `integration_sync_runs`)
- Or add a manual "Sync now" UI in the integration detail pages

### Priority 4 — Optional polish (3 warnings, low impact)

`task_events`, `model_routing_log`, `routine_runs` lack user-level INSERT policies. These are intentionally service-role-only writes, so the fix is just to confirm + document. No functional change needed.

### Recommended sequence
1. Migration: P1 RLS fixes (1.1, 1.2, 1.3) + P3.1 dedupe + unique constraint
2. Migration + code: P2 private buckets + update image/video gen functions to use signed URLs
3. Feature work: P3.2 wire up the "Sync now" button for YouTube + ClickUp
4. Document P4 as intentional

### Technical notes
- Realtime RLS uses the pattern `realtime.topic() like auth.uid()::text || ':%'` — channels must be named `<uid>:<resource>`, which may require a small client-side channel naming refactor
- Switching buckets to private requires updating any `getPublicUrl` callers to `createSignedUrl` with a TTL
- The unique constraint on `integration_connections` should use `(user_id, provider)` partial where `status = 'connected'` to allow historical disconnected rows

