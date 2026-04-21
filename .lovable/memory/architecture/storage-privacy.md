---
name: Storage bucket privacy
description: generated-images and generated-videos are private; edge functions return short-lived signed URLs (7-day TTL)
type: feature
---
**Buckets:** `generated-images` and `generated-videos` are private (`public=false`). Storage RLS is owner-scoped via `auth.uid()::text = (storage.foldername(name))[1]`.

**Edge functions** `image-gen` and `video-gen` return signed URLs via `createSignedUrl(path, 7 days)` instead of `getPublicUrl()`. Existing public URLs in the DB will stop resolving — re-generate or migrate as needed.

**To extend TTL or refresh:** add a small edge function that takes a path and returns a fresh signed URL.
