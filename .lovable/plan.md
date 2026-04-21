

## Next Steps — Prioritized

The previous round shipped P1.1, P1.2, P2 (private buckets + signed URLs), and P3.1 (dedupe + unique index). Two items from that plan were deferred, plus a few new opportunities surfaced. Here's what's left.

### Priority 1 — Wire up "Sync Now" for ClickUp + YouTube (deferred from last round)

The `SyncControl` component already has a "Sync Now" button and `integration_sync_runs` table is ready, but no `onSync` handler is wired in the detail pages. All `last_sync_at` columns remain null.

**Work:**
- Add `youtube/sync_videos` and `clickup/sync_tasks` actions to the existing edge functions
  - Lifecycle: insert `integration_sync_runs` row → `queued` → `running` → `succeeded`/`failed`
  - YouTube: fetch latest 50 videos for the connected channel, store metadata
  - ClickUp: fetch tasks from the user's default list, store summary in `metadata`
- Add a `sync_runs` table viewer (last 5 runs) to each detail page
- Wire `onSync` prop on `SyncControl` in `YouTubeDetail.tsx` and `ClickUpDetail.tsx`

### Priority 2 — Realtime channel authorization (deferred P1.3)

`realtime.messages` has no RLS, so any authenticated user can subscribe to any topic. The fix requires a small client-side channel naming convention change.

**Work:**
- Add RLS policy on `realtime.messages`:
  `realtime.topic() like auth.uid()::text || ':%'`
- Refactor channel names in `useChatStream.ts`, `ThreadView.tsx`, `TaskActivityPortal.tsx` to use `<uid>:<resource>` prefix (e.g. `chat_sessions` → `${uid}:chat_sessions`)
- Backend publishers (edge functions) must broadcast to the same prefixed channel

### Priority 3 — Storage signed-URL refresh helper

Signed URLs expire after 7 days. Old generated images/videos referenced in chat history will 404 after that window.

**Work:**
- Add lightweight `media-signed-url` edge function: takes `{ bucket, path }`, returns a fresh signed URL
- Wire `<ArtifactRenderer>` to call it lazily on image/video render if URL is expired (catch 403/expired token)

### Priority 4 — Document service-role-only writes

Three tables (`task_events`, `model_routing_log`, `routine_runs`) lack user INSERT policies — intentional, since only edge functions (service_role) write to them. The linter still flags these as warnings.

**Work:**
- Add a memory note documenting the design intent
- Mark the three findings as "intentional" in the security scanner

### Recommended sequence

```text
1. P1 — Sync Now wiring (highest user value, unblocks integration sync UX)
2. P2 — Realtime RLS + channel rename (security, low UI risk)
3. P3 — Signed URL refresh (prevents future broken media)
4. P4 — Documentation pass
```

### Technical notes

- Sync runs should set `started_at` on insert and `completed_at` on terminal status
- Update `integration_connections.last_sync_at` on successful run completion via trigger or in-function update
- For Realtime RLS, channels broadcast from edge functions need to use `supabase.realtime.send()` to a uid-prefixed topic; existing `postgres_changes` subscriptions are filtered by RLS automatically once the policy is in place
- Signed URL TTL trade-off: longer (30 days) reduces refresh calls; shorter (1 day) limits exposure if a URL leaks. 7 days is a reasonable middle ground.

