

# Fix Gmail Tools: Remove DELETE, Always Use Trash

## Problem
The `delete_email` and `batch_delete_emails` tools use the HTTP `DELETE` method, which fails with a permissions error on the Maton gateway. The user has confirmed that only `POST /messages/{id}/trash` works.

## Changes

### 1. Remove `delete_email` and `batch_delete_emails` tools entirely
- Remove both tool definitions from `MATON_ACTION_TOOLS`
- Remove both `case` handlers from `executeToolCall`
- Remove entries from the connection map and status strings
- The existing `trash_email` and `batch_trash_emails` tools already cover this functionality

### 2. Update system prompt
Add a note in the Gmail section: "Always use trash for deletion. Never use HTTP DELETE on messages."

### 3. Update `fetchGmailData` metadata fetching
The memory notes that Maton drops repeated query params (multiple `metadataHeaders`). The current code already uses `format=full&fields=payload/headers,snippet,labelIds` which works. No change needed here — `format=full` with `fields` filtering is the correct pattern per the gateway constraint.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/chat/index.ts` | Remove 2 tool defs, 2 case handlers, update system prompt |

