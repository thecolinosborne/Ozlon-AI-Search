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

**Per-service OAuth redirect (UX rule):** Each Google service detail page owns its own OAuth redirect URI: `/integrations/{serviceId}` (e.g. `/integrations/gmail`, `/integrations/google-calendar`). The shared `GoogleServiceDetail` component:
1. Sends `redirectUri = ${origin}/integrations/${config.serviceId}` to `youtube` edge function's `oauth_authorize`.
2. On mount, if `?code=` is present in the URL, exchanges it via `oauth_callback` with the same per-service `redirectUri`, then strips query params.

This means users stay on the page they authorized from — no surprise redirect to YouTube. The `youtube` edge function remains the single OAuth handler (it owns `oauth_authorize`/`oauth_callback` and writes to the shared `provider="youtube"` connection row), but the redirect destination is per-service.

**Adding a new Google service** requires whitelisting `https://{domain}/integrations/{newServiceId}` in Google Cloud Console under the OAuth client's "Authorized redirect URIs" for all three environments (custom domain, published `.lovable.app`, preview `id-preview--*.lovable.app`).

`YouTubeDetail.tsx` is the only Google page that does NOT render `GoogleServiceDetail` — it has its own bespoke implementation with its own callback handler at `/integrations/youtube`. Both flows write to the same shared OAuth connection row, so they don't conflict.
