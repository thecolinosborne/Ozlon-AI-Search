# Close the "email attachment → ClickUp task" gap

The AI hit two missing capabilities:
1. It can't enumerate attachments across an entire Gmail thread (only analyze one if it knows the right messageId).
2. There's no tool to upload a file as an attachment on a ClickUp task.

Plan adds three small, surgical tools — no UI changes, no refactors.

## 1. Gmail: list attachments

**Edge function** `supabase/functions/google-gmail/index.ts` — add two new action cases:

- `list_attachments({ messageId })` → returns `[{ attachmentId, filename, mimeType, sizeBytes, inline }]` by walking `payload.parts` of the message (same traversal already used by `analyze_attachment`).
- `list_thread_attachments({ threadId })` → calls `threads/{id}?format=full`, iterates every message, returns `[{ messageId, internalDate, from, subject, attachmentId, filename, mimeType, sizeBytes }]`.

**Manifest** `supabase/functions/_shared/integrations/gmail.ts` — register two tools:

- `gmail_list_attachments` — "List downloadable attachments on a single Gmail message."
- `gmail_list_thread_attachments` — "List downloadable attachments across every message in a Gmail thread. Use this when the user references 'the PDF in Ben's email' but the first message in the thread doesn't carry the file."

## 2. ClickUp: upload task attachment

**Edge function** `supabase/functions/clickup/index.ts` — add action `upload_task_attachment`:

- Input: `{ task_id, filename, mimeType, dataBase64 }` (optional `custom_task_ids`, `team_id`).
- Decode base64 → `Blob` → `FormData` with field name `attachment` (ClickUp's required field).
- POST to `https://api.clickup.com/api/v2/task/{task_id}/attachment` with the user's ClickUp token (resolved the same way every other clickup action resolves it).
- Return `{ success, attachment: { id, url, title, ... } }` from ClickUp's response.

**Manifest** `supabase/functions/_shared/integrations/clickup.ts` — register `clickup_upload_task_attachment` tool with schema `{ task_id, filename, mimeType, dataBase64 }`, marked `sideEffect: "write"`, `requiresConfirmation: false` (it's additive, non-destructive).

## 3. Wire the chain in chat system prompt

In `supabase/functions/chat/index.ts`, add a one-paragraph note in the tools section:

> When a user asks to attach an email file to a ClickUp task: call `gmail_list_thread_attachments` (or `gmail_list_attachments` if you already have the messageId), find the matching file, call `gmail_get_attachment` to get the base64 data, then call `clickup_upload_task_attachment` with `{task_id, filename, mimeType, dataBase64}`. Confirm to the user once attached.

## Deploy

Deploy `google-gmail`, `clickup`, and `chat` after edits.

## Out of scope

- No new UI.
- No changes to existing `analyze_attachment` / `get_attachment` behavior.
- No multi-file batch upload (model can loop if needed).
