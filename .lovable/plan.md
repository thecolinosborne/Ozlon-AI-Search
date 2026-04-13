

# Phase 1: Video Studio — Implementation Ready

Final polish incorporated. No structural changes, just three explicit decisions locked in.

## Polish items added

1. **Migration comment on 1:1 intent**: Add `COMMENT ON COLUMN public.video_tasks.work_task_id IS 'Strict 1:1 extension of a parent work_task. Each work_task has at most one video_task.';` in migration.

2. **Default sorting in useVideoTasks**:
   - Dashboard listing: `ORDER BY created_at DESC` (newest first)
   - Render history within detail: sorted by `started_at DESC` (most recent attempt first)

3. **Parent delete in UI**: The `useWorkTasks` hook's `archiveTask` removes the task from local state via `.filter()`. Since video tasks are fetched by joining on `work_task_id`, a deleted/archived parent naturally disappears from the Studio dashboard. No extra handling needed — the cascade + re-fetch covers it.

## Implementation sequence (unchanged)

1. **Migration** — `video_tasks` table with UNIQUE on `work_task_id`, all CHECKs, NOT NULL JSONB defaults, indexes, RLS, trigger, SQL comment
2. **Types** — `src/types/video.ts`
3. **Hook** — `src/hooks/useVideoTasks.ts` with explicit sort orders
4. **Components** — 5 files in `src/components/studio/`
5. **Navigation** — Update `TasksSidebar.tsx` + `Tasks.tsx`

All previous decisions (task_type: `'creative'`, intent_type: `'content'`, approve/reject behavior, CHECK constraints, render_progress bounds, edit_plan shape) remain locked.

Ready to build.

