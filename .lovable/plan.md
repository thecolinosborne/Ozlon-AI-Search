

## Two surgical, scalable fixes — shipped in sequence

Splitting into two independent PRs so each is reviewable, revertable, and can't break the other. Fix 1 is frontend-only and zero-risk. Fix 2 touches one edge function with additive changes only.

---

### Fix 1 — Descript key visibility (frontend only, ~10 lines)

**Scope:** `src/pages/integrations/DescriptDetail.tsx` only.

**Change:** Add one mount-effect that, when the local store has no `apiKey` but a `descript` row exists in `integration_connections` for the current user, hydrates `metadata.api_key` (or just the last-4 hint) into the local store via `updateSettings("descript", { apiKey })`.

**Why scalable:** Same pattern can be lifted into a tiny `useHydrateConnection(provider)` hook later for every integration page, but we don't refactor now — only Descript page is touched.

**Safety:** RLS already restricts `integration_connections` to `auth.uid()`. Read-only. No backend change. No schema change. If it fails, field stays blank exactly like today.

**Verify:** Hard refresh `/integrations/descript` → masked `•••• xxxx` + "connected" pill, Test Connection passes.

---

### Fix 2 — Multi-task update reliability (backend only)

**Scope:** `supabase/functions/chat/index.ts` only. No schema, no RLS, no new tables.

Four additive changes inside the existing tool handler:

**2a. Loosen `VALID_TASK_TRANSITIONS`** (~L2879)
```text
todo          → in_progress, up_for_review, completed, cancelled
in_progress   → todo, up_for_review, completed, cancelled
up_for_review → todo, in_progress, completed, cancelled
completed     → in_progress, up_for_review
cancelled     → todo, in_progress
```

**2b. Validate against fresh DB row, not cached value**
In `update_work_task` handler: `SELECT status FROM work_tasks WHERE id=$1 AND user_id=$2` immediately before the transition check. Use that as `from_status`. Kills the "second update in a batch fails" bug caused by stale local state.

**2c. Add `bulk_update_work_tasks` tool**
New tool, additive — old `update_work_task` stays untouched for backward compat. Accepts `updates: [{id, status?, title?, ...}]`, loops server-side, returns `{ succeeded: [{id}], failed: [{id, reason}] }`. AI gets per-task structured results (matches the no-swallowed-errors policy).

**2d. Refresh task snapshot between tool calls in same turn**
After any `*_work_task` tool returns inside the tool loop, re-fetch the user's open `work_tasks` before the next model call. Cheap query, eliminates stale-snapshot mismatches on chained edits.

**Why scalable:** Same fresh-read + bulk-tool + per-item failure shape is the template for any future multi-entity tool (emails, contacts, calendar). We're establishing the pattern once on tasks.

**Safety:**
- All four changes are additive or relax existing rules. No transition that works today stops working.
- New `bulk_` tool is opt-in — AI only uses it when it sees multiple updates in one turn.
- Per-call DB read is one indexed lookup by primary key. Negligible cost.
- Snapshot refresh is the same query already run at turn start, just repeated.
- If 2c or 2d misbehave, revert that single block — 2a + 2b stand on their own and already fix the user-reported failures.

**Verify:**
1. "Mark tasks A, B, C completed and cancel D" in one message → all four resolve; any failure names the specific task + reason.
2. Move a `todo` task straight to `completed` → succeeds.
3. Move 5 tasks where one was deleted out-of-band → 4 succeed, 1 reports "not found" with id.

---

### Out of scope (explicitly not touching)

- Slack flow we just shipped.
- RLS, work_tasks schema, Descript edge function, vault flow.
- Any UI redesign on either page.
- Other integration detail pages (Descript-only hydration this round).

### Order of operations

Ship Fix 1 first (zero backend risk, instant user value), confirm in preview, then ship Fix 2.

