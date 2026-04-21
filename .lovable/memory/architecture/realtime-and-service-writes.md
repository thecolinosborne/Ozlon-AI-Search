---
name: Realtime authorization & service-role-only tables
description: Realtime topic broadcasts must be uid-prefixed; task_events/model_routing_log/routine_runs are intentionally writable only by service_role
type: feature
---
**Realtime broadcast authorization:** `realtime.messages` has RLS — `realtime.topic() LIKE auth.uid()::text || ':%'`. Any custom broadcast channel name must start with `<uid>:` (e.g. `${user.id}:tasks`). `postgres_changes` subscriptions are unaffected; they use the underlying table's RLS.

**Service-role-only writes (intentional, no user INSERT policy needed):**
- `task_events` — written by edge functions when AI completes work
- `model_routing_log` — written by gauntlet-router/chat for routing telemetry
- `routine_runs` — written by scheduled-routines cron worker

These tables expose user-scoped SELECT for transparency, but writes go through trusted server code only. Security scanner warnings on these are documented as intentional.
