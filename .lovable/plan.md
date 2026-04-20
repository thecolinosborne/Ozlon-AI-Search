
User reports 4 issues on `/tasks`:
1. "Open in chat" button doesn't navigate / doesn't work.
2. No "Delete task" button (separate from "Mark done" → trash).
3. No back button in top-left of `/tasks` page.
4. Chat inside a task isn't using the full chat edge function (tools, integrations, model router) — it's hitting `execute-task` which is a stripped-down loop.

Let me check the current state of `TaskDetail`, `ThreadView`, and `useThread` to confirm what they call.
<lov-tool-use id="toolu_vrtx_01TfrjHcCGaoC1B6BfTwBxG6" name="code--view" integration-id="code" data="{\"file_path\": \"src/components/tasks/TaskDetail.tsx\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01Qwdzc6amyfgkAjCgycdHMK" name="code--view" integration-id="code" data="{\"file_path\": \"src/components/threads/ThreadView.tsx\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01SwnV7iXiC4y4R7U5AqprQp" name="code--view" integration-id="code" data="{\"file_path\": \"src/hooks/useThread.ts\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01SUBRR6pG6foLXp2bQFP2LG" name="code--view" integration-id="code" data="{\"file_path\": \"src/components/tasks/TaskDetail.tsx\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01RWahCXhaQwk7gA6wUL1nAj" name="code--view" integration-id="code" data="{\"file_path\": \"src/components/threads/ThreadView.tsx\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01D8qHqDeNkmqRk3AmHSPChm" name="code--view" integration-id="code" data="{\"file_path\": \"src/hooks/useThread.ts\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_011zoqDeDCMaD9rkTXwuXB7N" name="code--view" integration-id="code" data="{\"file_path\": \"src/hooks/useWorkTasks.ts\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01WMFrVuRvujQkCeEQgD65Pi" name="code--view" integration-id="code" data="{\"file_path\": \"src/pages/Index.tsx\", \"lines\": \"1-80\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01Xi42H24yJQKVL8z257aLnw" name="code--view" integration-id="code" data="{\"file_path\": \"supabase/functions/execute-task/index.ts\"}">
</lov-tool-use>
I have enough to plan. Let me check how Index.tsx handles `?session=` param.
<lov-tool-use id="toolu_vrtx_01P4qD6ZF7r2YGj5HsjuKTzv" name="code--search_files" integration-id="code" data="{\"query\": \"session=|searchParams.*session|switchSession\", \"search_dir\": \"src/pages/Index.tsx\"}">
</lov-tool-use>
Index.tsx doesn't read `?session=` from URL — that's why "Open in chat" doesn't work. Now I have everything.

<lov-plan>

## Issues
1. **"Open in chat" doesn't work** — `TaskDetail` navigates to `/?session=<id>` but `Index.tsx` never reads that query param to call `switchSession`.
2. **No delete button** — `TaskDetail` only has Mark done / Archive. Need a real "Delete" that soft-deletes (sends to trash) without marking done.
3. **No back button** — `Tasks.tsx` header has no way to leave the page.
4. **Chat parity in task threads** — currently `ThreadView` only persists messages + invokes `execute-task`. It works (execute-task → /chat with `enableTools: true`, so all tools, integrations and the Infinity Router are already available), but we should make the in-task chat look and behave like the main chat: streaming deltas, model routing visibility, attachments. Right now it waits for the whole turn before showing the assistant message — feels broken vs the real chat.

## Plan

### 1. Make `/?session=<id>` work
`src/pages/Index.tsx`
- On mount, read `useSearchParams().get('session')`. If present and `sessionsLoaded` and not already active, call `handleSwitchSession(id)` then strip the param.

### 2. Add Delete + Back buttons
`src/components/tasks/TaskDetail.tsx`
- Add a `Trash2` button next to Mark done that calls a new `softDelete(id)` (sets `deleted_at = now()` on both `work_tasks` and the linked `chat_sessions` — same as `markDone` but without setting status to 'done'). Confirms via toast.
- Surface `softDelete` from `useWorkTasks` (refactor `markDone` to share logic, but keep both: Mark done = status='done' + soft-delete; Delete = soft-delete only, preserves status).

`src/pages/Tasks.tsx`
- Add a `<Button variant="ghost" onClick={() => navigate('/')}>` with `ArrowLeft` icon at the very left of the sticky header.

### 3. Real chat experience inside the task thread
`src/components/threads/ThreadView.tsx` + new helper
- Replace the current "invoke execute-task and wait" flow with a streaming flow that mirrors `useChatStream`:
  - On send, persist user message (already done), then call `streamChat` from `chatService.ts` directly with `enableTools: true`, `userSettings`, current thread's message history, and an `onDelta` that appends to a live "in-flight" assistant bubble.
  - On `onDone`, persist the final assistant message into `chat_messages` (so it survives reload) AND call a lightweight `execute-task` follow-up only if the AI's output looks like a deliverable (or just always, server-side, to write the artifact). Cleanest: keep `execute-task` as the artifact extractor — call it once after streaming completes with `{ thread_id, finalize_only: true, assistant_message_id }`, which will read the just-saved message and produce the artifact without re-running the AI.
  - This gives users token-by-token streaming, tool-call visibility, and identical behavior to the main chat — same edge function, same model router, same Infinity Router, same integrations.

`supabase/functions/execute-task/index.ts`
- Add a `finalize_only` mode: skips `streamChat`, takes the existing assistant message text, runs `detectArtifactType`, writes the artifact + updates the thread pointer. Reuses everything else.

### 4. Files

**Edited**
- `src/pages/Tasks.tsx` — back button in header.
- `src/pages/Index.tsx` — read `?session=` param and switch.
- `src/components/tasks/TaskDetail.tsx` — Delete button.
- `src/hooks/useWorkTasks.ts` — `softDelete(id)` helper (no status change, just `deleted_at`).
- `src/components/threads/ThreadView.tsx` — stream via `chatService.streamChat` instead of waiting for `execute-task`; call `execute-task` in `finalize_only` mode at the end for artifact extraction.
- `supabase/functions/execute-task/index.ts` — handle `finalize_only` branch.

## Constraints honored
Additive only. Same edge function (`/chat`) and same tools the main chat uses — Infinity Router, all 12 Maton Google services, GoHighLevel, ClickUp, Plaid, knowledge search, memory, web search. Apple Vision Pro minimal. No emojis. Soft-delete uses existing 30-day trash mechanism.
