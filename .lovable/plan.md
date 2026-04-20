

User wants a full end-to-end audit, executed. This is verification work — I'll run probes, query the DB, and report PASS/FAIL/NOT WIRED across every integration and every chat↔task sync scenario. No code changes unless something breaks; if so, I report and ask before fixing.

## Audit Scope

### A. Code parity (read-only review)
1. `src/components/threads/ThreadView.tsx` + `src/hooks/useThread.ts` — confirm both stream via `chatService.streamChat` with `enableTools: true` (same as main `Index.tsx`).
2. `useConversations` vs `useWorkTasks` — both filter `deleted_at IS NULL` and subscribe to realtime `chat_sessions` updates.
3. `Index.tsx` `?session=<id>` deep-link still works after `sessionsLoaded`.
4. `execute-task` `finalize_only` branch wired correctly.
5. **Confirm zero Maton references remain** anywhere in `src/` and `supabase/functions/`.

### B. Integration matrix — live edge function probes
For each, call the edge function directly with my JWT and verify (a) HTTP 200, (b) real data returned, (c) per-user OAuth/API key resolution working:

| # | Integration | Edge fn | Probe |
|---|---|---|---|
| 1 | Gmail | `google-gmail` | list 3 newest |
| 2 | Calendar | `google-calendar` | today's events |
| 3 | Drive | `google-drive` | list recent files |
| 4 | Docs | `google-docs` | list recent docs |
| 5 | Sheets | `google-sheets` | list recent sheets |
| 6 | Slides | `google-slides` | list recent decks |
| 7 | GSC | `google-search-console` | list sites |
| 8 | GA4 | `google-analytics` | list accounts |
| 9 | Tag Manager | `google-tag-manager` | list accounts |
| 10 | YouTube | `youtube` | list channels |
| 11 | GoHighLevel | `gohighlevel` | list contacts |
| 12 | ClickUp | `clickup` | list spaces |
| 13 | Plaid | `plaid` | list accounts |
| 14 | Knowledge | `knowledge-search` | semantic probe |
| 15 | Descript | `descript` | list projects |
| 16 | Higgsfield | `higgsfield` | list jobs |

Then call `/chat` with `enableTools: true` for the top 5 (Gmail, Calendar, Drive, GHL, ClickUp) to confirm the tool actually fires inside the chat loop and `tools_used` shows up in the SSE stream.

### C. Chat ↔ Task sync (DB queries)
1. Latest 5 `chat_sessions` rows: confirm `kind`, `linked_work_task_id`, `deleted_at` columns populate correctly.
2. Latest 5 `work_tasks`: confirm each has a matching `chat_sessions` row via `linked_work_task_id`.
3. Pick one test session, query `chat_messages` count, confirm same count visible in both the main chat and task-thread views (no duplicates, no missing turns).
4. Soft-delete pair: any `work_tasks.deleted_at IS NOT NULL` should have matching `chat_sessions.deleted_at IS NOT NULL`.
5. Confirm `task_events` rows exist for promote/done/restore actions.

### D. Report format

```
=== INTEGRATIONS ===
[PASS]  google-gmail        — returned 3 messages
[FAIL]  gohighlevel         — 401, no API key for user
[NOT WIRED] tag-manager     — connection exists but tool not in /chat registry

=== CHAT ↔ TASK SYNC ===
[PASS]  message parity       — 12 messages identical in both views
[FAIL]  soft-delete sync     — 2 work_tasks deleted, sessions still visible

=== MATON PURGE ===
[PASS]  zero references in src/ + supabase/functions/
```

Each FAIL gets one-line root cause + suggested fix. No edits made until you approve fixes.

### E. Out of scope
No code changes. No UI changes. If failures found → separate fix plan, your approval required.

