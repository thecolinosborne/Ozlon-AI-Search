

# Video Studio Navigation & Global BottomNav

## Files to change

### 1. Create `src/pages/Studio.tsx`
Standalone page matching Tasks.tsx layout: auth guard via `useEffect`, `min-h-screen bg-background pb-20`, sticky header with `backdrop-blur-xl`, `max-w-6xl mx-auto px-4 py-4` content area, loading spinner. Wraps `VideoStudioDashboard`.

### 2. Edit `src/App.tsx`
- Extract routes into an inner `AppRoutes` component that uses `useLocation()` inside router context
- Add `<Route path="/studio" element={<Studio />} />`
- Render `<BottomNav />` conditionally: hide when `pathname.startsWith('/auth')` or `pathname.startsWith('/onboarding')` — uses `startsWith` to cover sub-paths
- Import Studio page

### 3. Edit `src/components/UserMenu.tsx`
- Add `Film` to lucide imports
- Add "Video Studio" `DropdownMenuItem` linking to `/studio`, placed after the Tasks item (line 112)

### 4. Edit `src/components/tasks/TasksSidebar.tsx`
- Remove `'studio'` from `TaskView` type → becomes `'overview' | 'board' | 'active' | 'review' | 'completed' | 'activity'`
- Remove `Film` from imports
- Remove the studio entry from the `views` array

### 5. Edit `src/pages/Tasks.tsx`
- Remove `VideoStudioDashboard` import
- Remove `BottomNav` import and `<BottomNav />` usage (line 168)
- Remove the `activeView === 'studio'` rendering block (lines 147-149)

### Sanity checks incorporated
- **A. Hidden nav routes**: `startsWith('/auth')` and `startsWith('/onboarding')` covers all sub-paths
- **B. Bottom padding**: Studio.tsx gets `pb-20`; Tasks.tsx already has it; Index.tsx will be checked — if missing, add it
- **C. Type cleanup**: Removing `'studio'` from TaskView removes it from the type, the views array, and the switch/render logic. The `counts` object never had a `studio` key, so no dead references remain.

