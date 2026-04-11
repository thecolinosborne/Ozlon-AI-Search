

# Incorporate Gmail Delete Tool & Validate Connection

## Current State
The Gmail integration is already comprehensive with 9 tools: `send_email`, `create_email_draft`, `list_emails`, `get_email`, `trash_email`, `batch_trash_emails`, `list_email_ids`, `label_email`, `mark_email_read`. All use `format=full`, the `Maton-Connection` header, and `Bearer $MATON_API_KEY` auth — matching the patterns you provided.

## What's Missing
One capability from your provided tools is not yet implemented: **permanent email deletion** (`DELETE /messages/{id}`). Currently only trash (recoverable) is supported.

## Changes

### 1. Add `delete_email` tool to `MATON_ACTION_TOOLS`
A new tool definition for permanently deleting an email (irreversible). Description will clearly warn the user this is permanent vs trash.

### 2. Add `batch_delete_emails` tool
Mirrors `batch_trash_emails` but uses the DELETE method for permanent removal. Useful for bulk cleanup of spam/junk.

### 3. Add execution handlers in `executeToolCall`
- `delete_email`: `DELETE /google-mail/gmail/v1/users/me/messages/{id}` (returns 204 on success)
- `batch_delete_emails`: Parallel DELETE calls in chunks of 10

### 4. Redeploy the chat edge function

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/chat/index.ts` | Add 2 tool definitions + 2 case handlers |

## Note
The connection ID `18e9357f-cdfd-4112-b6d7-b69ed5cdec58` for `colin@ozlon.net` is already being resolved dynamically through the Maton connections API — no hardcoding needed. The existing `fetchGmailData` already pulls the 20 most recent emails chronologically with `format=full` and parallel metadata fetching, exactly matching the patterns you provided.

