

# Fix Higgsfield API — Align with Official Docs + Add Image-to-Video

The edge function uses wrong base URL (`api.higgsfield.ai/v1`), wrong auth format (`X-App-Id` + `Bearer`), and wrong endpoints. The official API docs confirm completely different patterns.

## Changes

### 1. Rewrite `supabase/functions/higgsfield/index.ts`

- **Base URL**: `https://platform.higgsfield.ai`
- **Auth header**: `Authorization: Key ${HIGGSFIELD_APP_ID}:${HIGGSFIELD_API_KEY}`
- **Actions**:
  - `generate_image` → `POST /higgsfield-ai/soul/standard` with `{ prompt, aspect_ratio, resolution }`
  - `generate_video` → `POST /higgsfield-ai/dop/standard` with `{ image_url, prompt, duration }` (image-to-video)
  - `get_job_status` → `GET /requests/{request_id}/status`
  - `cancel_job` → `POST /requests/{request_id}/cancel`
  - `test_connection` — unchanged (checks secrets exist, no external call)
  - Remove `list_generations` (not in API)

### 2. Update `src/pages/integrations/HiggsFieldDetail.tsx`

Update capabilities list and model info to reflect real API:
- Text-to-image via `higgsfield-ai/soul/standard`
- Image-to-video via `higgsfield-ai/dop/standard`
- Async queue pattern with status polling
- Request cancellation support
- Multiple aspect ratios and resolutions

### 3. Deploy + test image generation

Deploy the updated function, then call `generate_image` with a test prompt and poll for the result.

## Files changed
- `supabase/functions/higgsfield/index.ts` — full rewrite
- `src/pages/integrations/HiggsFieldDetail.tsx` — update capabilities text

## What stays untouched
- All other integrations, pages, stores — zero changes
- Secrets `HIGGSFIELD_APP_ID` and `HIGGSFIELD_API_KEY` already configured
- Viral Creative backend function — unchanged

