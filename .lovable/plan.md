

# Remotion Integration: AI Edit Plans + Simulated Render Pipeline (Final)

All feedback incorporated. Key additions: state guards on start/complete, double-start protection, explicit progress ownership, full history entries.

## Architecture

```text
generate_plan:
  AI → EditPlanAction[] → UPDATE video_tasks SET edit_plan, edit_plan_status='generated'

start_render:
  Guard: reject if render_status IN (queued, rendering, completed)
  SET queued → SET rendering (progress=0) → return immediately

complete_render:
  Guard: reject if render_status !== 'rendering'
  SET completed, progress=100, deterministic output_url
  Append full success render_history entry

Progress ownership:
  Backend persists: queued, rendering, completed, failed
  Frontend simulates: intermediate progress (25, 50, 75) locally for UX only
  DB never stores intermediate percentages — only 0 and 100
```

## Edge function: `render-video`

Three actions, all stateless single-transition.

### `action: generate_plan`
- Reads video_task from DB
- Calls Lovable AI Gateway to produce `EditPlanAction[]`
- Writes back: `UPDATE video_tasks SET edit_plan = $plan, edit_plan_status = 'generated'`
- On AI failure: returns 500, no DB mutation

### `action: start_render`
- **Guards** (return 400, no mutation):
  - Task not found → 404
  - `edit_plan_status !== 'approved'`
  - `edit_plan` is empty array
  - `render_status` is `queued`, `rendering`, or `completed` (double-start protection)
- On pass: SET `render_status = 'queued'`, then `'rendering'`, `render_progress = 0`
- Returns immediately

### `action: complete_render`
- **Guards** (return 400, no mutation):
  - Task not found → 404
  - `render_status !== 'rendering'` — rejects stray/repeated calls
- On pass:
  - SET `render_status = 'completed'`, `render_progress = 100`
  - SET `output_url = 'https://mock-renders.lovable.app/${video_task_id}.mp4'`
  - Append **full** render_history entry: `{ id, started_at, completed_at, status: 'completed', output_url, error: null }`
- On any DB error during update:
  - SET `render_status = 'failed'`
  - Append error entry: `{ id, started_at, completed_at: now(), status: 'failed', output_url: null, error: '<message>' }`

### Design notes
- `// TEMPORARY: simulated render. Replace with real Remotion Lambda/Cloud worker.`
- `// Progress: backend persists only queued/rendering/completed/failed. Frontend simulates intermediate % locally.`
- Uses `SUPABASE_SERVICE_ROLE_KEY` for DB writes, `LOVABLE_API_KEY` for AI

## Frontend: `useVideoTasks.ts`

### `generateEditPlan(taskId)`
- Calls edge function `generate_plan`
- Updates local state from response

### `startRender(taskId)`
- Calls edge function `start_render`
- On success: starts client-side visual simulation via `setInterval` (2s ticks: 25→50→75→100)
- At 100%: calls `complete_render`, refreshes task
- **These percentages are local only — never written to DB**
- Cleanup: interval cleared on complete, fail, or unmount via ref

### Polling cleanup
```text
const renderInterval = useRef<number>();
useEffect(() => () => clearInterval(renderInterval.current), []);
```

## UI: `VideoTaskDetail.tsx`
- "Generate Edit Plan" → `generateEditPlan`
- "Start Render" → `startRender`, disabled while `queued` or `rendering`
- Progress bar driven by local simulated value
- Success state on complete

## Remotion scaffold
- `remotion/` directory with template compositions (ShortForm, Promo, Square)
- Code-only — not installed, ready for Phase 2

## Files

| File | Action |
|------|--------|
| `supabase/functions/render-video/index.ts` | **Create** |
| `remotion/package.json` | **Create** |
| `remotion/tsconfig.json` | **Create** |
| `remotion/src/index.ts` | **Create** |
| `remotion/src/Root.tsx` | **Create** |
| `remotion/src/templates/ShortFormTemplate.tsx` | **Create** |
| `remotion/src/templates/PromoTemplate.tsx` | **Create** |
| `remotion/src/templates/SquareTemplate.tsx` | **Create** |
| `src/hooks/useVideoTasks.ts` | **Edit** |
| `src/components/studio/VideoStudioDashboard.tsx` | **Edit** |
| `src/components/studio/VideoTaskDetail.tsx` | **Edit** |

