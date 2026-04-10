

# Fix Email Cleaning: Newest-First + Reliable Batch Trash + Real-Time Streaming

## Problems

1. **Emails processed oldest-first**: Gmail API defaults to relevance-based ordering. No explicit sort is applied, so the AI processes whatever Gmail returns first — not the newest emails you care about.
2. **`batch_trash_emails` uses wrong API**: `batchModify` with `addLabelIds: ['TRASH']` is unreliable. Gmail requires individual `POST /messages/{id}/trash` calls.
3. **Only 25 emails per cycle**: `list_emails` caps metadata fetches at 25, so the AI thinks it's done after one small batch.
4. **Task updates not real-time**: All `task_update` SSE events are collected and dumped at the end — the bubble never appears while work is happening.
5. **Tool loop capped at 5 iterations**: Not enough for bulk operations (fetch → trash → fetch next page → trash → summarize).

## Changes

### `supabase/functions/chat/index.ts`

**1. Fix `list_emails` — newest first, more results**
- Add `&orderBy=internalDate desc` or prepend `newer_than:` to query defaults
- Actually: Gmail `messages.list` doesn't support `orderBy`. Instead, the results are already in reverse chronological order by default when using label queries like `in:inbox`. The issue is the 25-metadata cap. Increase batch to 50 and pass `maxResults=100`.

**2. Add `list_email_ids` tool — lightweight bulk fetcher**
- New tool that returns only message IDs (no metadata fetch), up to 500, with `pageToken` support
- Lets the AI see the full scope before deciding what to trash

**3. Fix `batch_trash_emails` — use individual trash calls**
- Replace `batchModify` with parallel `POST /messages/{id}/trash` calls in chunks of 10
- Return success/failure count

**4. Increase `maxIterations` from 5 to 10**
- Bulk email cleaning needs multiple fetch→trash cycles

**5. Stream task updates in real-time**
- Replace the "collect then dump" pattern with `TransformStream`
- Write `event: task_update` SSE lines immediately as each tool executes
- Write final content + `[DONE]` at the end
- The TaskActivityBubble will appear and update live

### No frontend changes needed
- `chatService.ts` already parses `event: task_update` SSE events
- `TaskActivityBubble` and store already work
- The only issue was the backend wasn't streaming them in real-time

## Summary of File Changes

| File | Change |
|------|--------|
| `supabase/functions/chat/index.ts` | Add `list_email_ids` tool, fix `batch_trash_emails` to use individual trash calls, increase metadata batch to 50, bump `maxIterations` to 10, refactor action-request path to use `TransformStream` for real-time SSE |

