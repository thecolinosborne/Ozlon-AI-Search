

# Fix Maton Error Badges and GHL Sync Validation

## Problem 1: Maton Services All Showing "Error"

**Root cause**: Case mismatch. The Maton API returns `status: "ACTIVE"` (uppercase), but MatonDetail.tsx line 113 checks `conn.status === "active"` (lowercase). Every single connection fails this check and falls through to `"error"` status.

**Fix**: Change the comparison to be case-insensitive: `conn.status.toLowerCase() === "active"`. Also add handling for `"PENDING"` connections so they show as "disconnected" instead of "error". Filter out or visually differentiate PENDING vs ACTIVE connections.

## Problem 2: GHL Sync Toggles Not Actually Syncing

**Root cause**: The `handleSync` function (line 88-94) is a fake 1.5-second `setTimeout` that never calls the GHL API. The data sync toggles just flip local Zustand state without verifying anything. Default `conversations` is `false`.

**Fix**: 
- Make `handleSync` actually call the GHL proxy for each enabled data type (contacts, pipelines, conversations) to validate the connection works
- Default all three sync toggles to `true` since the API is confirmed working
- On mount, when GHL connection is detected, also initialize `syncData` with all toggles on

## Files Changed

### `src/pages/integrations/MatonDetail.tsx`
- Fix status comparison: `conn.status.toUpperCase() === "ACTIVE"` maps to `"connected"`, `"PENDING"` maps to `"disconnected"`, everything else maps to `"error"`
- Add a count summary showing active vs pending vs total connections
- Sort connections: active first, then pending

### `src/pages/integrations/GoHighLevelDetail.tsx`
- Replace fake `handleSync` with real API validation calls to the GHL proxy for contacts, pipelines, and conversations
- Default `syncData` to `{ contacts: true, pipelines: true, conversations: true }`
- On mount auto-detect, also set `syncData` defaults to all `true`
- Show per-data-type sync status feedback (success/failure per type)

### `src/services/matonService.ts`
- Add a `url` field to the `MatonConnection` interface (already returned by API but not typed)
- No logic changes needed here

## What Stays the Same
- Edge functions untouched
- IntegrationStatusBadge component untouched
- Integrations overview page untouched
- Store logic untouched

