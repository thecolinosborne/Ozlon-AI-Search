---
name: Native Google OAuth (Maton replaced)
description: All Google services (Gmail, Calendar, Drive, Docs, Sheets, Slides, GSC, GA4, Tag Manager, YouTube) call Google APIs directly with the user's OAuth token via _shared/google-token.ts — Maton gateway is permanently removed
type: feature
---
All Google services are called natively from per-service edge functions: `google-gmail`, `google-calendar`, `google-drive`, `google-docs`, `google-sheets`, `google-slides`, `google-search-console`, `google-analytics`, `google-tag-manager`, `youtube`.

**Auth model:** Each function calls `getGoogleAccessToken(userId)` from `supabase/functions/_shared/google-token.ts`, which:
1. Reads the user's OAuth tokens from `integration_connections` (provider='youtube', auth_type='oauth2') with RLS-enforced isolation.
2. Auto-refreshes the access token using the stored refresh token + `YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET` when expired.
3. Returns a valid bearer token for direct calls to `gmail.googleapis.com`, `www.googleapis.com`, `searchconsole.googleapis.com`, `analyticsdata.googleapis.com`, etc.

**Maton is permanently removed.** Do not reintroduce any gateway proxy, `MATON_*` constants, `maton.ai` URLs, or tool aliases referencing it. The chat edge function exposes Google tools that invoke these native edge functions directly.
