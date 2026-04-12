

# ClickUp AI Project Manager Integration

## Summary
Build a full ClickUp integration with an edge function proxy, two database tables, a detail page, and bidirectional AI communication where the AI acts as a project manager inside ClickUp task comments. The existing chat function, AI processor, Infinity Router, memory system, and all other integrations remain completely untouched.

## Architecture

```text
User comments "@AI ..." on ClickUp task
  → ClickUp webhook (taskCommentPosted)
  → supabase/functions/clickup/index.ts (action: webhook)
    → validate, deduplicate, detect intent
    → fetch task context (title, description, status, comments)
    → build PM-augmented prompt
    → call existing chat edge function (non-streaming)
    → post AI reply back to ClickUp task comment
    → mark event processed in DB
```

## Secrets Required (3 new)
- `CLICKUP_API_TOKEN` — ClickUp personal API token
- `CLICKUP_TEAM_ID` — workspace/team ID
- `CLICKUP_DEFAULT_LIST_ID` — default list for tasks

These will be requested via the add_secret tool before implementation proceeds.

## Database Migrations (2 new tables)

### `clickup_processed_comments`
Idempotency table — prevents duplicate webhook processing.
- `id` uuid PK
- `comment_id` text UNIQUE NOT NULL
- `task_id` text NOT NULL
- `event_type` text
- `status` text DEFAULT 'processed'
- `response_comment_id` text nullable
- `error_message` text nullable
- `handled_at` timestamptz DEFAULT now()
- `created_at` timestamptz DEFAULT now()

RLS enabled, no policies (server-side access only via service role).

### `clickup_integration_state`
Configuration for reply behavior and webhook status.
- `id` uuid PK
- `team_id` text
- `default_list_id` text
- `webhook_id` text nullable
- `webhook_status` text DEFAULT 'not_registered'
- `auto_reply_enabled` boolean DEFAULT true
- `reply_trigger_mode` text DEFAULT 'mention_only'
- `ai_reply_mode` text DEFAULT 'standard'
- `allow_subtask_creation` boolean DEFAULT false
- `allow_task_updates` boolean DEFAULT false
- `max_reply_length` integer DEFAULT 2000
- `cooldown_seconds` integer DEFAULT 30
- `last_tested_at` timestamptz nullable
- `last_webhook_event_at` timestamptz nullable
- `last_successful_ai_reply_at` timestamptz nullable
- `last_error` text nullable
- `created_at` timestamptz DEFAULT now()
- `updated_at` timestamptz DEFAULT now()

RLS enabled, no policies (server-side only).

## New Files

### 1. `supabase/functions/clickup/index.ts` (~500 lines)
Action-based proxy following the GoHighLevel pattern exactly.

**Standard CRUD actions:**
- `test_connection` — validate env vars, GET `/api/v2/team`, return structured status
- `list_tasks` — GET `/api/v2/list/{listId}/task`
- `get_task` — GET `/api/v2/task/{taskId}`
- `create_task` — POST `/api/v2/list/{listId}/task`
- `update_task` — PUT `/api/v2/task/{taskId}`
- `create_comment` — POST `/api/v2/task/{taskId}/comment`
- `create_subtask` — POST `/api/v2/list/{listId}/task` with `parent` field
- `list_comments` — GET `/api/v2/task/{taskId}/comment`
- `register_webhook` — POST `/api/v2/team/{teamId}/webhook`
- `get_config` — read `clickup_integration_state`
- `update_config` — update reply settings

**PM-specific actions:**
- `get_task_context` — fetch task + comments + assignees bundle
- `analyze_task` — call chat with PM prompt for task analysis
- `suggest_next_steps` — PM-prompted next step suggestions
- `suggest_priority` — priority classification
- `detect_blockers` — blocker identification
- `generate_project_update` — draft status update
- `create_execution_plan` — structured plan from vague input

**Webhook handler** (`action: webhook`):
1. Validate payload, extract comment_id/task_id/text
2. Check `clickup_processed_comments` for duplicates → skip if exists
3. Check if comment has `[AI]` marker → skip (loop prevention)
4. Check trigger mode from `clickup_integration_state` → skip if `mention_only` and no `@ai`/`@pm`/`@wisdom`
5. Check cooldown (last reply timestamp on same task)
6. Fetch task context: title, description, status, assignees, due date, tags, last 10 comments
7. Detect intent from comment text (summarize, next_steps, blockers, priority, subtasks, update, plan, or general question)
8. Build chat payload with PM system prompt + structured task context
9. Call chat edge function (non-streaming, collect full response)
10. Format reply (truncate, prepend `[AI]` marker)
11. POST comment back to ClickUp task
12. If explicit subtask/update request AND config allows → execute action
13. Mark comment processed in DB

**PM system prompt layer** (augments existing assistant, doesn't replace):
```
You are acting as a project manager inside ClickUp.
Prioritize clarity, execution, prioritization, dependency awareness, and concise action.
Structure responses for task execution. Identify next steps clearly.
Call out blockers and dependencies. Do not fabricate project facts.
Only take direct task-changing actions when explicitly requested.
```

**Safety features:**
- `[AI]` marker prefix on all AI comments
- Duplicate detection via `clickup_processed_comments` table
- Per-task cooldown (default 30s)
- Trigger modes: `mention_only` (default), `always`, `disabled`
- Subtask creation and task updates disabled by default (configurable)
- Max reply length with safe truncation
- Graceful failure on all API errors

### 2. `src/pages/integrations/ClickUpDetail.tsx`
Follows GoHighLevel pattern exactly using `IntegrationDetailLayout` + `SyncControl`.

Sections:
- Connection status (team ID, list ID, auth verified)
- Webhook status (registered/not registered)
- Register Webhook button
- Reply Settings: auto-reply toggle, trigger mode selector (mention_only/always/disabled), reply mode (brief/standard/detailed)
- Permission toggles: allow subtask creation, allow task updates
- Test actions: Test Connection, Fetch Tasks, Create Test Task
- Info panel: "Mention @AI in a ClickUp task comment and the AI will respond directly on that task. Ask for summaries, blockers, next steps, subtasks, updates, and priorities."

## Modified Files

### 3. `src/pages/Integrations.tsx`
Add one entry to `integrations` array:
```typescript
{ id: "clickup", name: "ClickUp", description: "Task management with AI-powered project manager replies inside task comments.", icon: CheckSquare, path: "/integrations/clickup" }
```

### 4. `src/App.tsx`
Add import and route:
```typescript
import ClickUpDetail from "@/pages/integrations/ClickUpDetail";
<Route path="/integrations/clickup" element={<ClickUpDetail />} />
```

### 5. `supabase/config.toml`
Add:
```toml
[functions.clickup]
verify_jwt = false
```

## What Does NOT Change
- `supabase/functions/chat/index.ts` — untouched (called as external dependency)
- AI Processor page/logic — untouched
- Infinity Router — untouched
- Memory system — untouched
- Integrations store schema — untouched (uses existing generic structure)
- All other integration pages — untouched
- All other edge functions — untouched

## Implementation Order
1. Request ClickUp secrets via add_secret tool
2. Create database migration (2 tables)
3. Create `supabase/functions/clickup/index.ts`
4. Create `src/pages/integrations/ClickUpDetail.tsx`
5. Update `Integrations.tsx` and `App.tsx` (additive only)
6. Update `config.toml`
7. Deploy and test edge function
8. Verify connection, CRUD, and webhook flow

