---
name: GHL sub-account resolution priority
description: How the chat function decides which GoHighLevel sub-account to use on every turn, and where session/default memory is stored
type: feature
---
GoHighLevel sub-account selection on every chat turn follows a strict 4-step priority:

1. **Explicit in this message** — model calls `ghl_set_active_sub_account` (mutates `ghlCreds` for the rest of the turn AND writes `chat_sessions.active_ghl_location_id` for future messages in this conversation).
2. **Session memory** — `chat_sessions.active_ghl_location_id` (per chat session, set by step 1 or by a previous turn's `ghl_set_active_sub_account` call).
3. **User default** — `profiles.default_ghl_location_id` (permanent, set by `ghl_set_default_sub_account` tool OR the "AI default" button on the GHL detail page).
4. **Metadata fallback** — `integration_connections.metadata.location_id` or first sub_account with an api_key.

When step 2 or 3 wins, the system prompt notes the source ("[active for this session]" or "[user default]") so the model can confirm to the user.

Tools:
- `ghl_set_active_sub_account` — temporary (this conversation only). Persists to `chat_sessions.active_ghl_location_id`.
- `ghl_set_default_sub_account` — permanent (all future conversations). Writes to `profiles.default_ghl_location_id`.

UI: GoHighLevelDetail.tsx shows a green "AI Default" pill on whichever sub-account matches `profiles.default_ghl_location_id`, with an "AI default" button on the others to switch it.

This pattern should be generalized to other multi-account integrations (ClickUp workspaces, Slack workspaces, Google accounts) when needed.
