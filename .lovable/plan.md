# Make the assistant remember past chats and edit the right document

## The problem you're hitting

Two separate gaps in the system, both real:

1. **No cross-session recall.** Each chat session only loads its own messages. When you start a new chat and ask "redo the task we just tested," the model literally cannot see the previous session — it only sees the current one plus whatever you explicitly told it to `save_memory`. That's why follow-ups feel amnesiac.

2. **No document continuity.** When you ask it to "edit that doc," it has no record of *which* Google Doc it touched last time, so it falls back to `docs_create_document` and you end up with duplicates. There's an `artifacts` table that stores some outputs, but Google Docs IDs from prior turns aren't searchable by the model in a new session.

## What this plan adds

### 1. Cross-session chat recall tool
A new `recall_past_chats` tool the model can call when you reference something earlier ("the test we just did", "that task from before", "what did we decide yesterday"). It searches your own prior `chat_messages` by keyword + recency (last 30 days, your user id only), returns the top matching exchanges with session id and timestamp, and the model uses that context before acting.

No new embeddings infra required for v1 — Postgres full-text search over `chat_messages.content` is fast enough and avoids re-embedding the entire history. Embedding-based recall can be a phase 2 if FTS isn't sharp enough.

### 2. Document/artifact ledger
Every time the assistant creates or edits a Google Doc, Sheet, ClickUp task, etc., we already log the external id in `artifacts.external_ref`. We'll add:

- A `recall_recent_artifacts` tool that lists the user's last ~20 artifacts (title, type, external id, when, which session) so the model can find "the doc from last time" before deciding to create a new one.
- A system-prompt rule: *"Before calling any `*_create_*` tool, call `recall_recent_artifacts` if the user references a prior document/task/sheet. Prefer update over create."*
- Backfill writes for `docs_create_document`, `docs_insert_text`, and ClickUp create paths so they always record an artifact row with the external id. Some already do; some don't.

### 3. Explicit "use this doc" handle
When you say "edit the doc we made last time," the model will:
1. Call `recall_recent_artifacts` (and `recall_past_chats` if needed),
2. Show you the candidate ("Updating *Q4 SEO Plan* — created Tue") and proceed,
3. Call `docs_insert_text` / `docs_replace_text` against the existing `documentId` instead of `docs_create_document`.

If you want, a stricter mode can require confirmation before any new-document creation when a recent similar artifact exists.

## Technical details

**New edge function tools (in `supabase/functions/chat/index.ts`):**
- `recall_past_chats({ query, days?=30, limit?=8 })` → SQL: `SELECT session_id, role, content, created_at FROM chat_messages WHERE user_id = $auth AND created_at > now() - $days AND content ILIKE '%' || $query || '%' ORDER BY created_at DESC LIMIT $limit`. Returns trimmed snippets.
- `recall_recent_artifacts({ type?, limit?=20 })` → reads `artifacts` filtered by `user_id` and optional `type`, returns id, title, type, external_ref, updated_at, conversation_id.

**Artifact write-through (gap fix):**
- In the `docs_create_document` handler, after success, insert into `artifacts` with `type='doc_link'`, `external_ref={ documentId, url }`.
- Same for the ClickUp create-task path (`type='action_result'`, `external_ref={ taskId, listId }`) — confirms the record needed for "update that task."

**System prompt additions (small, surgical):**
- One paragraph telling the model to call recall tools when the user uses anaphoric references ("that doc", "the task", "what we did"), and to prefer update tools over create tools when a match is found.

**No schema changes required.** `chat_messages`, `artifacts`, and `chat_sessions` already have everything we need. Indexes already cover `user_id + created_at`. If FTS performance becomes an issue we can add a `to_tsvector` index later.

**No UI changes.** This is all backend / system-prompt work. The chat UI keeps behaving the same; the model just gets smarter about reaching back.

## What it won't do (so we're aligned)

- It won't auto-merge sessions or change how the sidebar groups chats.
- It won't replay full prior conversations into context (token cost) — it pulls targeted snippets on demand.
- It won't silently overwrite a doc; for destructive replacements it still asks you to confirm, per the existing list-confirm-act rule.
