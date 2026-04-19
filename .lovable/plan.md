
The user wants me to upgrade the previous plan into something "next-gen" and more optimal at the personal-user scale. Let me think harder about what that means for a single-user personal AI OS rather than copying ChatGPT's task UI.

Key insight: at personal scale, "tasks" shouldn't feel like tickets in Jira. They should feel like ongoing **threads of intent** the assistant is carrying for you in the background — a pet project, a draft email, a "remind me to think about this," a "keep researching X." The AI should work on them while you sleep, surface only what needs your attention, and let any thread jump fluidly between **chat ↔ task ↔ deliverable** without friction.

Here's the upgraded plan.

---

## Vision: Tasks as living threads, not tickets

Three upgrades that make this actually next-gen for a single user:

1. **Unified thread model** — Chat sessions and tasks share the same underlying message stream. A "task" is just a chat thread with a goal, status, and deliverable attached. No duplicate data, no sync logic, no "push to chat" gymnastics — they're already the same thing, just two views of it.
2. **Autonomous background work** — Tasks can run on their own (scheduled, triggered, or self-continued) and surface only when the AI needs you or has something ready. Your inbox becomes "what needs your eyes," not "what I told it to do."
3. **Typed deliverables with live artifacts** — Outputs aren't blobs of markdown. They're typed artifacts (doc, draft email, image, link, checklist, decision) that render natively, version themselves, and can be edited in place or pushed to the real world (Drive, Gmail, Calendar) in one tap.

## Architecture

### One thread, two views

```text
                  ┌──────────────────┐
                  │  conversations   │  (renamed from chat_sessions)
                  │  + kind: chat /  │
                  │    task / both   │
                  │  + goal, status, │
                  │    artifact_id   │
                  └────────┬─────────┘
                           │
                  ┌────────┴─────────┐
                  │   chat_messages  │  (already exists, reused as-is)
                  └────────┬─────────┘
                           │
                  ┌────────┴─────────┐
                  │    artifacts     │  (typed deliverables, versioned)
                  └──────────────────┘
```

- A chat is a `conversation` with `kind='chat'`.
- A task is a `conversation` with `kind='task'` plus `goal`, `status`, `priority`, `current_artifact_id`.
- "Promote chat to task" = set `kind='both'` + add a goal. "Continue task in chat" = open the same conversation in the chat view. **Zero data movement.**
- `work_tasks` becomes a thin view/migration over this.

### Typed artifacts

Replace `draft_output: text` with an `artifacts` table:

```text
artifacts(
  id, conversation_id, version, type, title,
  content jsonb,         -- shape depends on type
  external_ref jsonb,    -- e.g. { provider: 'google_docs', id: '...' }
  status,                -- draft | approved | published
  created_by             -- 'ai' | 'user'
)
```

Types the renderer knows how to display inline: `markdown`, `email_draft`, `doc_link`, `image`, `file`, `checklist`, `decision`, `action_result`. Each version is preserved, so revisions are diff-able and revertable.

### Autonomy loop

A task can be in `awaiting_user`, `working`, `scheduled`, `blocked`, or `done`. The existing `execute-task` function gets:

- A **continue** mode — when the AI finishes a turn, it decides: *"do I need the user, or can I keep going?"* and either pings you or schedules its own next step via `scheduled_routines`.
- A **trigger** mode — tasks can subscribe to events ("when a new email from X arrives, draft a reply and put it in review").
- A **digest** — instead of N notifications, one daily "here's what I worked on, here's what needs you" thread.

### Push to real world (one-tap actions on artifacts)

Each artifact type has 1–3 native actions wired to existing edge functions:
- `email_draft` → "Send via Gmail" (uses `google-gmail`)
- `markdown` → "Save to Google Doc" (uses `google-docs`)
- `checklist` → "Push to ClickUp" (uses `clickup`)
- `decision` → "Add to calendar" / "Save to memory"

No new integrations needed — just buttons that call what's already there.

## UX flow

```text
┌─ Thread: "Launch email for v2" ──────── status: awaiting you ┐
│                                                              │
│  You · 2:14pm                                                │
│     "Write a launch email for v2"                            │
│                                                              │
│  Ozlon · 2:14pm                                              │
│     ┌─ Artifact · email_draft · v2 ────────────────────┐    │
│     │ Subject: v2 is here — and it's faster            │    │
│     │ Hi {{name}}, ...                                 │    │
│     │ [ Send via Gmail ] [ Save as Doc ] [ Revise ]    │    │
│     └──────────────────────────────────────────────────┘    │
│                                                              │
│  You · 2:16pm                                                │
│     "shorter, friendlier"                                    │
│                                                              │
│  Ozlon · 2:16pm                                              │
│     ┌─ Artifact · email_draft · v3 ────────────────────┐    │
│     │ ...revised...                                    │    │
│     └──────────────────────────────────────────────────┘    │
│                                                              │
│  ─────────────────────────────────────────────────────────  │
│  > follow up...                  [ Open in Chat ] [ Send ]  │
└──────────────────────────────────────────────────────────────┘
```

Same thread, opened from `/tasks` shows kanban metadata; opened from `/` (chat) shows it as a normal session with the artifact pinned at the top.

## Files

**New**
- `supabase/migrations/<ts>_unified_threads_and_artifacts.sql` — adds `kind`, `goal`, `status`, `priority`, `current_artifact_id` to `chat_sessions`; new `artifacts` table with RLS + realtime; backfill from `work_tasks`.
- `src/components/threads/ArtifactRenderer.tsx` — type-aware renderer with action buttons.
- `src/components/threads/ThreadView.tsx` — shared thread surface used by both chat and task detail.
- `src/hooks/useThread.ts` — single hook for messages + artifacts + realtime.
- `src/hooks/useArtifacts.ts` — versioning, revert, promote.

**Edited**
- `supabase/functions/execute-task/index.ts` — supports follow-ups, persists messages into `chat_messages`, writes artifacts (typed) instead of `draft_output`, and decides whether to continue autonomously or wait.
- `src/pages/Tasks.tsx` — kanban cards link to ThreadView; "Open in Chat" reuses the same thread.
- `src/pages/Index.tsx` (chat) — adds "Make this a task" on any AI message; banner when current session is also a task.
- `src/hooks/useWorkTasks.ts` → thin wrapper over `useThread` filtered by `kind in ('task','both')`.
- `src/components/UserMenu.tsx` — Tasks link already added; no change.

## What the user gets that the previous plan didn't

- **No "push to chat" feature needed** — chat and task are the same thread, viewed two ways.
- **Real artifacts, not text blobs** — emails actually send, docs actually save, with versions you can revert.
- **The AI works while you sleep** — autonomous continuation + daily digest instead of constant pinging.
- **Built on what exists** — reuses `chat_messages`, `chat_sessions`, `scheduled_routines`, `execute-task`, and every Google/ClickUp tool already wired. Net new tables: 1 (`artifacts`).

## Constraints honored
Additive only. Apple Vision Pro minimal aesthetic. No emojis. RLS on every new table. Realtime via existing Supabase channels. Existing kanban, chat, voice, and integrations untouched.
