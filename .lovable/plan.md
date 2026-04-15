

## YouTube Upload + Fix All Build Errors

### What's Needed for YouTube Upload

Uploading videos via the YouTube API requires **OAuth 2.0** — an API key alone only supports read-only operations. Here's what needs to happen:

**Your side (Google Cloud Console):**
1. You already have a YouTube Data API key — keep it for read operations
2. In your Google Cloud project, create an **OAuth 2.0 Client ID** (Web application type)
3. Set these values:
   - **Authorized JavaScript origins**: `https://ozlon.ai` and `https://ozlon-hello-orb.lovable.app`
   - **Authorized redirect URI**: `https://ozlon-hello-orb.lovable.app/integrations/youtube` (we'll handle the callback here)
4. Enable the **YouTube Data API v3** in your Google Cloud project
5. On the OAuth consent screen, add scope: `https://www.googleapis.com/auth/youtube.upload`

**Lovable side — what I'll build:**

### 1. Store OAuth Client ID and Secret as backend secrets
- `YOUTUBE_CLIENT_ID` — your Google OAuth client ID
- `YOUTUBE_CLIENT_SECRET` — your Google OAuth client secret

### 2. Add OAuth flow to the YouTube edge function
New actions:
- `oauth_authorize` — generates the Google OAuth URL with `youtube.upload` scope, returns it to the frontend
- `oauth_callback` — exchanges the auth code for access/refresh tokens, stores them securely in `integration_connections`
- `upload_video` — uses the stored OAuth token to upload a video via YouTube's resumable upload API

### 3. Update the YouTube Detail page
- Add an "OAuth Client ID" input field
- Add "Authorize YouTube Upload" button that kicks off the OAuth flow
- Show OAuth connection status (read-only vs. upload-enabled)
- Add an upload section (appears after OAuth is connected)

### 4. Fix all 6 existing build errors

| File | Error | Fix |
|---|---|---|
| `chat/index.ts:3191` | `{} \| null` not assignable to `string` | Cast: `taskRowId = (taskRow?.id as string) \|\| null` |
| `chat/index.ts:3557` | `createClient` not found | Add dynamic import like line 3184 |
| `clickup/index.ts:198` | `tokenOverride` undefined in `fetchTaskContext` | Add `tokenOverride?` parameter to function signature |
| `clickup/index.ts:637,648` | `fetchTaskContext` called with 2 args | Matches fix above — signature now accepts 2 |
| `render-video/index.ts:261` | `err` is `unknown` | `(err instanceof Error ? err.message : String(err))` |
| `ClickUpDetail.tsx` | `getAuthParams` not found (11 errors) | Add helper function that returns `{ teamId, defaultListId }` from component state |

### Files Changed

| File | Change |
|---|---|
| `supabase/functions/youtube/index.ts` | Add `oauth_authorize`, `oauth_callback`, `upload_video` actions |
| `src/pages/integrations/YouTubeDetail.tsx` | Add OAuth Client ID field, authorize button, upload section |
| `supabase/functions/chat/index.ts` | Fix 2 type errors (lines 3191, 3557) |
| `supabase/functions/clickup/index.ts` | Fix `fetchTaskContext` signature, fix `tokenOverride` reference |
| `supabase/functions/render-video/index.ts` | Fix `err` unknown type |
| `src/pages/integrations/ClickUpDetail.tsx` | Add missing `getAuthParams` helper |

### After Approval

I'll ask you to add two secrets: `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` with your Google Cloud OAuth credentials.

