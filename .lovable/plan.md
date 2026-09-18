# Perfect Memory for Business Ops

Goal: Ozlon remembers every business action, document, decision, and resource across sessions, then surfaces the right context without being asked.

## What already exists

- `wisdom_memories` with embeddings for facts/preferences/patterns.
- `artifacts` ledger for docs, tasks, plans created in chat.
- `recall_past_chats`, `recall_recent_artifacts`, `save_memory`, `search_wisdom_memories` chat tools.
- Document ingestion and email-attachment memory.

## Gaps

1. No single place to see everything remembered.
2. Only some create-actions are auto-captured as artifacts (updates, scans, emails, calendar events mostly are not).
3. The assistant still does not always search memory before acting; anaphoric references ("that task", "the doc") can miss.
4. Business resources across tools (ClickUp task ↔ GHL contact ↔ Calendar event ↔ email) are not linked.

## Phase 1 — Memory command center

Add `/memory` to the nav. Page shows:

- Search bar over `wisdom_memories` + `artifacts` + `user_documents`.
- Filter chips: All | Facts | Preferences | Tasks | Docs | Events | Contacts | Decisions.
- Each card: type, summary, source tool, date, deep link where possible.
- Delete / "remember more like this" actions.

Backend: one edge function `memory-search` that unions semantic + keyword results and returns ranked matches.

## Phase 2 — Auto-capture every business action

After any tool call that touches an external resource, persist a memory/artifact:

- ClickUp: task created/updated, list/board, custom field changes, subtasks.
- GoHighLevel: contact created/updated, opportunity moved, message sent, task added.
- Google Calendar: event created/updated/deleted.
- Gmail: scan summaries, sent drafts, archived/deleted messages.
- Documents: uploaded, analyzed, extracted decisions.
- Life OS: rocks, issues, scorecard changes.

Format: `summary` (1 line), `content` (structured), `external_id`, `external_url`, `tool`, `resource_type`. Embed `summary` for semantic recall.

## Phase 3 — Proactive recall before action

In `chat/index.ts`, before the tool-selection step, run a lightweight memory search when the user message contains:

- Anaphora ("that", "it", "the one", "the doc", "the task")
- Reference to prior work ("update", "add to", "change", "follow up")
- A proper noun that could match a captured resource

Inject the top 3 relevant memories into the system context. If a match is high-confidence, prompt the model to prefer update/delete over create.

## Phase 4 — Relationship links

Add `memory_links` table: `source_memory_id`, `target_memory_id`, `relationship` (`created_from`, `related_to`, `follow_up_to`, `mentions`).

When a tool result references another resource (e.g. email → ClickUp task, task → calendar event), write a link. Surface related memories in the Memory page and in recall results.

## Suggested order

Phase 1 gives visibility and trust. Phase 2 makes the memory complete. Phase 3 makes it useful in chat. Phase 4 makes it intelligent.

Build Phase 1 and 2 first; they unlock Phase 3 in the same day.
