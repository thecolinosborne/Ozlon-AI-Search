

# Fix: YouTube Upload from Google Drive Links

## Problem
Google Drive share links (e.g. `https://drive.google.com/file/d/FILE_ID/view`) return an HTML preview page, not the raw video binary. The upload handler fetches this HTML and sends it to YouTube, which rejects it with "Media type 'text/html' is not supported."

## Fix (single file: `supabase/functions/youtube/index.ts`)

### 1. Auto-convert Google Drive links to direct download URLs
Before fetching, detect Drive link patterns and rewrite to the export format:
- `drive.google.com/file/d/{ID}/view` → `https://drive.google.com/uc?export=download&id={ID}`
- `drive.google.com/open?id={ID}` → same

This aligns with the existing memory rule (`mem://preferences/google-drive-link-conversion`).

### 2. Validate response content type after fetch
After downloading, check `content-type`. If it's `text/html`, throw a clear error explaining the URL didn't return a video file.

### 3. Infer correct MIME type
If content-type is missing or generic (`application/octet-stream`), infer from URL extension. Fall back to `video/mp4`. Use this validated MIME for both `X-Upload-Content-Type` and the PUT upload `Content-Type` instead of trusting `videoBlob.type`.

## Changes
Around lines 696-730 in `supabase/functions/youtube/index.ts`:
- Add Drive URL detection/conversion before `fetch(videoUrl)`
- Add content-type validation after response
- Add MIME inference logic
- Replace `videoBlob.type` references with the validated MIME

