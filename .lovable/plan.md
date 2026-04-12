

# Fix Higgsfield Auto-Detection & Viral Creative Integration

## Problems
1. Higgsfield detail page gets stuck on "Detecting backend API key..." — the edge function's `test_connection` tries to hit the external Higgsfield API with an 8-second timeout before responding, making the UI appear frozen
2. Error message in UI exposes internal secret name `HIGGSFIELD_API_KEY` — should be genericized
3. Viral Creative Intelligence page shows Higgsfield status but doesn't trigger Higgsfield auto-detection if user hasn't visited the Higgsfield page first

## Changes

### 1. Edge Function: Speed up `test_connection` (`supabase/functions/higgsfield/index.ts`)
- For `test_connection`, simply check if `HIGGSFIELD_API_KEY` env var exists and is non-empty
- Remove the external API call with 8-second timeout — key existence is sufficient proof of configuration
- Keep all other actions (generate_video, generate_image, etc.) unchanged

### 2. Frontend: Sanitize error message (`src/pages/integrations/HiggsFieldDetail.tsx`)
- Replace the message that says `Add HIGGSFIELD_API_KEY as a backend secret` with a generic message like "Backend API key not configured. Please add it as a backend secret."
- No secret names exposed to the browser

### 3. Frontend: Viral Creative triggers Higgsfield detection (`src/pages/integrations/ViralCreativeDetail.tsx`)
- On mount, after checking Viral Creative connection, also invoke `supabase.functions.invoke("higgsfield", { body: { action: "test_connection" } })` to populate the Higgsfield status in the integrations store
- This ensures Higgsfield shows "Connected" on the Viral Creative page even if user hasn't visited `/integrations/higgsfield` first
- Add explicit "Connected to Higgsfield" indicator with link to Higgsfield detail page

### 4. Verify two-way sync
- Higgsfield page already uses `SyncControl` with two-way sync default — no change needed
- Confirm the sync control renders after connection is established

## What stays untouched
- All other integrations, chat system, router, memory — zero changes
- Edge function actions for generate_video, generate_image, get_job_status, list_generations — unchanged
- `HIGGSFIELD_API_KEY` remains server-side only via `Deno.env.get()`

