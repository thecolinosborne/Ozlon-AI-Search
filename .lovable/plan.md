
Phase C — two surgical fixes. No refactor.

## Fix 1: ClickUp `create_task` (verify + wire)
Audit showed the tool entry exists at line 1442 and handler at line 4028 in `chat/index.ts`. I'll do a final verification pass and confirm it's reachable through the v2 domain gate (domain: `projects`). If the handler is broken or the tool definition is malformed, fix it. If already working, mark verified and move on.

## Fix 2: Soft-delete sync for `work_tasks`
**Bug**: chat context queries fetch `work_tasks` without filtering `deleted_at IS NULL`. Deleted tasks still appear in the model's context, causing it to reference/act on tasks the user trashed.

**Locations to patch** in `supabase/functions/chat/index.ts`:
- Line ~5915 (work_tasks context query) — add `.is('deleted_at', null)`
- Any other `from('work_tasks').select(...)` call without that filter — audit and patch
- The `work_tasks` tool handlers (`list_work_tasks`, `get_work_task`, etc.) — ensure they exclude trashed tasks unless explicitly requested

**Frontend check** (per "check both sides" rule):
- `src/hooks/useWorkTasks.ts` — confirm the default fetch already filters `deleted_at IS NULL` (it does, since trash view is opt-in via `{ trash: true }`)
- No frontend changes expected

## Verification
- Deploy `chat` function
- Smoke test: create a task → soft-delete it → ask the AI "what tasks do I have?" → confirm trashed task does NOT appear
- Confirm ClickUp `create_task` still callable

## Out of scope
- Phase A file split (deferred)
- Router changes
- New tools

## Files touched
- `supabase/functions/chat/index.ts` (add `deleted_at` filter to work_tasks queries; verify ClickUp create_task)

Approve and I execute.
