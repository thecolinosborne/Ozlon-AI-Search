

# Higgsfield Dual-Auth + Hide Viral Creative Layer

## What's changing

### 1. Store Higgsfield ID + Secret as separate secrets
Currently only `HIGGSFIELD_API_KEY` exists. We need to add a second secret `HIGGSFIELD_APP_ID` for the ID (`097b0582-bdee-42e3-a280-9a413faec9b4`) and update `HIGGSFIELD_API_KEY` with the secret key you provided. The edge function will use both for authentication.

### 2. Update Higgsfield edge function for dual-auth
Modify `supabase/functions/higgsfield/index.ts` to read both `HIGGSFIELD_APP_ID` and `HIGGSFIELD_API_KEY`, and use them together in the API headers (likely `X-App-Id` + `Authorization: Bearer <secret>`). The `test_connection` action will verify both are present.

### 3. Remove Viral Creative from UI — make it a pure backend service
- Remove the "Viral Creative Intelligence" card from `src/pages/Integrations.tsx`
- Remove the route from `App.tsx`
- Delete `src/pages/integrations/ViralCreativeDetail.tsx`
- Keep the `supabase/functions/viral-creative/index.ts` edge function intact — it becomes a purely internal service called by Higgsfield or other backend code
- Keep the database tables (`viral_creative_sessions`, `creative_reference_assets`) for logging

### 4. Fix Higgsfield "Connected" status on integration card
The edge function already returns `connected: true`. The Higgsfield detail page auto-detects on mount and writes to the integrations store, which persists via localStorage. The integration card on `/integrations` reads from that store. If the user hasn't visited the detail page yet, the card shows "Not Connected". Fix: run Higgsfield auto-detection from the Integrations hub page itself on mount, so the card always reflects the real status.

## Files changed
- `supabase/functions/higgsfield/index.ts` — dual-auth (ID + Secret)
- `src/pages/Integrations.tsx` — remove Viral Creative card, add Higgsfield auto-detect on mount
- `src/App.tsx` — remove Viral Creative route + import
- `src/pages/integrations/ViralCreativeDetail.tsx` — delete file
- New secret: `HIGGSFIELD_APP_ID`

## What stays untouched
- Chat, memory, Infinity Router, AI Processor, Descript, Maton, GHL, ClickUp — zero changes
- `viral-creative` edge function and DB tables remain (backend-only)
- All stores, services, hooks, core modules — zero changes

