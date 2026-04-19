
ClickUp confirmed working end-to-end. Of the 3 remaining items, ranking by risk × leverage:

**Recommended priority: Audit & migrate other integrations to per-user scoping.**

Why this first:
- It's the same class of bug we just spent 5 rounds fixing on ClickUp (shared global rows → wrong user's settings → 401s & "not configured" errors). GHL, Maton/Google, Descript, Higgsfield likely have the same pattern. Fixing now prevents the next 3-day fire drill.
- Multi-user scaling is blocked until this is done — second user signing in today would inherit your settings or overwrite them.
- Pure backend hardening, no UX risk.

The other two ranked:
- **#2 — "Which tool ran" footer.** Useful observability, low risk, ~15 min. Worth doing right after the audit so you can *see* the audit working.
- **#3 — Live multi-task test (Gmail→ClickUp).** You can run this yourself anytime in chat now that ClickUp is green. Doesn't need my involvement.

## Plan — Per-user scoping audit & migration

### Phase 1: Audit (read-only, ~5 min)
Scan each integration's edge function + state tables for the same anti-pattern ClickUp had:
- `gohighlevel_*` state tables → check if scoped by `user_id`
- `google-*` functions (gmail, drive, calendar, sheets, docs, GSC, GA, slides, GTM) → check token resolution path
- `descript_jobs` → already has `user_id`, verify reads filter on it
- `higgsfield` → check state storage
- `maton` if it has any state table

Output: a short table of which tables/functions need migration.

### Phase 2: Migrate any unscoped tables
For each table missing per-user scoping:
1. Add `user_id` + `connection_id` columns (nullable for backfill)
2. Backfill from existing `integration_connections` where possible
3. Add unique index `(user_id, provider_specific_key)`
4. Tighten RLS to `auth.uid() = user_id`
5. Update edge function reads/writes to filter by authenticated user

### Phase 3: Update edge functions
Apply the same `resolveAuth(userId, connectionId)` helper pattern from `clickup/index.ts` to each affected function. Priority: tokens prioritise user-scoped row, fall back to env only for webhooks without user context.

### Phase 4: Smoke test
Quick check on each migrated integration: load its detail page, verify status hydrates correctly, no console errors.

### Risk
Low — additive columns + RLS tightening. Each migration is one table at a time, reversible. No UX changes.

### Effort
Audit: 5 min. Migrations: ~10 min per affected integration. Realistically 30-60 min total depending on how many need it.

Approve and I'll start with Phase 1 audit and report back with the exact list before touching anything.
