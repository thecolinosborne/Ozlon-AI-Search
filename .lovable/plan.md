

# Smart Task Routing & Multi-Action Orchestration (Final)

Single file: `supabase/functions/chat/index.ts`

## Changes in order

### 1. Tool definition (after `create_work_task` ~line 1937)
Add `update_work_task` with `additionalProperties: false` on both top-level params and `activity_entry`. Enum-constrain `activity_entry.status` to `["thinking", "executing", "completed", "failed"]`.

### 2. Transition validator helper (before `executeToolCall`)
```typescript
const VALID_TRANSITIONS: Record<string, string[]> = {
  todo: ['in_progress'],
  in_progress: ['up_for_review'],
  up_for_review: ['in_progress', 'completed'],
  completed: ['in_progress'],
};

function isValidTransition(from: string, to: string): boolean {
  if (from === to) return true; // no-op is always safe
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
```

### 3. Handler case (before `default:` ~line 3274)
- Fetch existing task by `task_id`
- If `status` provided and differs from current, validate transition — reject if invalid
- If `status === existing.status`, skip validation (no-op)
- Build update with only provided fields; never null-overwrite `draft_output`
- Always set `last_activity_at = now()`
- If `activity_entry` provided, append `{ ...activity_entry, timestamp: now() }` to `ai_activity_log`

### 4. Registry
- `toolToService`: `'update_work_task': '_always_'`
- `TOOL_DISPLAY_NAMES`: `'update_work_task': 'Updating work task'`

### 5. System prompt (replace lines 3427-3439)

**Routing:** ClickUp mention → `create_clickup_task`. Actionable work → chain internal tools. Both → both. Trivial → no task.

**Chain:** `create_work_task` → `update_work_task`(in_progress) → work tool → `update_work_task`(up_for_review + draft_output). Failure → `ai_status: failed`, `next_action: waiting_on_human`.

**Smart defaults:** research→`task_type:"research"`,`intent_type:"ops"` | content→`task_type:"content"`,`intent_type:"marketing"` | email→`task_type:"email"`,`intent_type:"ops"` | client work→`intent_type:"fulfillment"` | marketing→`intent_type:"marketing"` | ops→`intent_type:"ops"`

**Transition rule in prompt:** Always follow `todo→in_progress→up_for_review→completed`. Never skip stages.

