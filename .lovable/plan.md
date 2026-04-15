
Goal: get “Authorize YouTube Uploads” working by aligning Google OAuth with the exact redirect URI the app is sending.

What I found
- The app is not guessing the redirect URI. In `src/pages/integrations/YouTubeDetail.tsx` it always sends:
  `window.location.origin + "/integrations/youtube"`
- Your screenshot shows Google is receiving:
  `https://ozlon.ai/integrations/youtube`
- That means Google must have that exact redirect URI on the same OAuth client ID used by the backend secrets.

Immediate fix in Google Cloud
1. Open the Web OAuth client whose ID is:
   `553189125514-7sjlt4r0le800bjrtp0f7obtvtcqe2if.apps.googleusercontent.com`
2. In that exact client, set these values:

JavaScript origins
```text
https://ozlon.ai
https://id-preview--4896957e-1c02-4264-8c4c-1c294087f925.lovable.app
https://ozlon-hello-orb.lovable.app
```

Authorized redirect URIs
```text
https://ozlon.ai/integrations/youtube
https://id-preview--4896957e-1c02-4264-8c4c-1c294087f925.lovable.app/integrations/youtube
https://ozlon-hello-orb.lovable.app/integrations/youtube
```

Important rules
- JavaScript origins: no path, no trailing slash
- Redirect URIs: must include `/integrations/youtube`
- Edit the same OAuth client ID the backend is using, not a different Google app

Why it is failing now
- Earlier you were testing on Lovable preview/published domains.
- Now the live request is coming from `ozlon.ai`.
- If `ozlon.ai` is missing from that OAuth client, Google returns `redirect_uri_mismatch`.

If you want me to implement a hardening pass after this
1. Add a read-only debug line in the YouTube page showing the exact redirect URI being used.
2. Add clearer OAuth error messaging so the page tells you which URI Google expected.
3. Keep the existing API key save behavior as-is so failed saves do not wipe the field.
4. Optionally add a small “Copy redirect URI” button for setup.

Technical details
- Frontend authorize call:
  `redirectUri: ${window.location.origin}/integrations/youtube`
- Frontend callback exchange:
  `redirectUri: ${window.location.origin}/integrations/youtube`
- Backend passes that value directly to Google in `supabase/functions/youtube/index.ts`
- So this is a Google OAuth client configuration mismatch, not a routing issue

Success check
- After saving the Google settings, wait 1–2 minutes
- Open the integration from the same domain you configured
- Click “Authorize YouTube Uploads”
- If it still fails, the most likely cause is you updated the wrong Google OAuth client record
