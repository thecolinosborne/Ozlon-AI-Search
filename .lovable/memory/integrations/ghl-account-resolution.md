---
name: GHL sub-account resolution priority
description: How the chat function decides which GoHighLevel sub-account to use on every turn, where session/default memory is stored, and the write guardrail that prevents wrong-account writes
type: feature
---
GoHighLevel sub-account selection on every chat turn follows a strict 5-step priority:

1. **Explicit in this message** — model calls `ghl_set_active_sub_account` (mutates `ghlCreds` for the rest of the turn AND writes `chat_sessions.active_ghl_location_id` for future messages in this conversation). Sets `__ghlSwitchedThisTurn=true`.
2. **Context binding (NEW)** — chat handler scans the last 10 messages for any sub-account name. If one is mentioned and resolves to a different `locationId` than steps 3-5 would pick, that account wins, is persisted to `chat_sessions.active_ghl_location_id`, and `__ghlMemorySource='context'`.
3. **Session memory** — `chat_sessions.active_ghl_location_id` (per chat session, set by step 1/2 or by a previous turn).
4. **User default** — `profiles.default_ghl_location_id` (permanent, set by `ghl_set_default_sub_account` tool OR the "AI default" button on the GHL detail page). Source = `default`.
5. **Metadata fallback** — `integration_connections.metadata.location_id` or first sub_account with an api_key.

When step 2/3/4 wins, the system prompt notes the source ("[active for this session]" / "[user default]") so the model can confirm to the user.

## Write guardrail (CRITICAL — prevents wrong-account writes)

Before executing any GHL write tool (`ghl_create_*`, `ghl_update_*`, `ghl_delete_*`, `ghl_archive_*`, `ghl_send_*`, `ghl_upsert_*`, `ghl_book_*`, `ghl_cancel_*`, `ghl_add_*`, `ghl_remove_*`, `ghl_edit_*`, `ghl_trigger_*`, `ghl_import_*`, `ghl_upload_*`), the tool loop checks:

- If `__ghlMemorySource === 'default'` AND the model has NOT called `ghl_set_active_sub_account` this turn AND the conversation mentions a different sub-account name, the write is BLOCKED and returns `{ error: "AMBIGUOUS_SUBACCOUNT", resolved_account, mentioned_account, fix }`.
- The system prompt instructs the model to call `ghl_set_active_sub_account(name=<mentioned_account>)` and retry exactly once.

Successful writes always echo the target sub-account in the result string: `[Account: <Name>] ...` so wrong-account writes are caught instantly.

## Tools
- `ghl_set_active_sub_account` — temporary (this conversation only). Persists to `chat_sessions.active_ghl_location_id`. Sets `__ghlSwitchedThisTurn=true`.
- `ghl_set_default_sub_account` — permanent (all future conversations). Writes to `profiles.default_ghl_location_id`.

## UI
GoHighLevelDetail.tsx shows a green "AI Default" pill on whichever sub-account matches `profiles.default_ghl_location_id`, with an "AI default" button on the others to switch it.

This pattern should be generalized to other multi-account integrations (ClickUp workspaces, Slack workspaces, Google accounts) when needed.
