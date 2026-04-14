

# Fix: Deterministic Route State for /tasks

## Problem
`useWorkTasks` starts with `loading = true` but has no `error` state. The page combines `authLoading || loading` into one spinner. If a fetch fails, `loading` becomes `false` but there's no error UI — and critically, the hook fires `fetchTasks` during auth bootstrap when `session` may not be ready yet, causing ambiguous timing. The activity view also mutates `tasks` in-place with `.sort()`.

## Changes

### 1. `src/hooks/useWorkTasks.ts`

- Add `authLoading` from `useAuth()` and gate the fetch effect: skip fetch while `authLoading` is true
- Start with `loading = false` instead of `true` — let the effect set it to `true` only when it actually starts fetching
- Add `error: string | null` state, exposed in the return value
- In `fetchTasks`: clear `error` at start; on query error or exception, set `error` to a user-facing message; always reset `loading` in `finally`
- Store `AbortController` in a ref so cleanup can abort in-flight requests on unmount or re-fetch, preventing stale responses
- Add `fetchIdRef` (incrementing counter) so that when a new fetch starts, completed responses from earlier fetches are discarded
- Return `error` and `fetchTasks` (already returned) so the page can render error UI with retry

### 2. `src/pages/Tasks.tsx`

- Destructure `error` and `fetchTasks` from `useWorkTasks()`
- Replace the single `authLoading || loading` guard with a sequential resolution:
  1. `authLoading` → spinner
  2. `!session` → redirect (already exists, keep as-is)
  3. `error` → inline error card with "Retry" button calling `fetchTasks()`
  4. `loading` → spinner (only when tasks array is empty, so a background refetch doesn't flash spinner over existing data)
  5. `tasks.length === 0` → empty state
  6. else → loaded content
- Fix activity view: `[...tasks].sort(...)` instead of `tasks.sort(...)`

### Files modified
| File | What changes |
|------|-------------|
| `src/hooks/useWorkTasks.ts` | Add `error` state, gate fetch on `authLoading`, abort controller cleanup, fetch ID staleness guard |
| `src/pages/Tasks.tsx` | Deterministic state resolution, error UI with retry, fix sort mutation |

