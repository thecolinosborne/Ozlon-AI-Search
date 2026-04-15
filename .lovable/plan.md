

## Polish Integration Detail Pages

### Changes

**1. ApiKeyInput — show masked value when configured**

Update `ApiKeyInput` to accept an optional `currentValue` prop. When `configured` is true and no new value is being entered, display `••••••••••••` with a "Configured" badge (already exists) and show a masked representation. The existing input already shows `••••••••••••` as placeholder — this is fine, but we'll also add an optional `description` prop so each page can show what's stored (e.g. the last 4 chars).

Add a new optional prop `maskedHint` (e.g. `"••••dk4f"`) so integrations can display a recognizable hint of the stored key.

**2. Remove SyncControl from all integration pages**

Remove all `<SyncControl>` usage from:
- `ClickUpDetail.tsx` (line 335-341)
- `GoHighLevelDetail.tsx` (line 192-198)
- `DescriptDetail.tsx` (line 249-253)
- `HiggsFieldDetail.tsx` (line ~SyncControl usage)
- `MatonDetail.tsx` (line ~SyncControl usage)
- `YouTubeDetail.tsx` (line 332)

Also remove the `setSyncDirection` calls/imports where no longer used. The `SyncControl` component and store fields can remain (no breaking changes) but won't render.

**3. Show stored credentials when connected**

For each integration, when a key is already saved in `settings`, pass `maskedHint` to `ApiKeyInput` showing `"••••" + last4chars` so the user can see something is there.

### Files Changed

| File | Change |
|---|---|
| `src/components/integrations/ApiKeyInput.tsx` | Add `maskedHint` prop, display it when configured |
| `src/pages/integrations/ClickUpDetail.tsx` | Remove SyncControl, pass maskedHint |
| `src/pages/integrations/GoHighLevelDetail.tsx` | Remove SyncControl, pass maskedHint |
| `src/pages/integrations/DescriptDetail.tsx` | Remove SyncControl, pass maskedHint |
| `src/pages/integrations/HiggsFieldDetail.tsx` | Remove SyncControl, pass maskedHint |
| `src/pages/integrations/MatonDetail.tsx` | Remove SyncControl, pass maskedHint |
| `src/pages/integrations/YouTubeDetail.tsx` | Remove SyncControl |

