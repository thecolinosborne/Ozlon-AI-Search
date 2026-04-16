
The user wants to know if they can use the existing YouTube OAuth (which has Drive scope after the recent fix) to also power Gmail and Google Drive natively, replacing Maton for those services.

**Answer: Yes, technically — but with important nuances I should surface before building.**

Current state:
- YouTube OAuth client has scopes: `youtube.upload`, `youtube.readonly`, `drive.readonly` (just added)
- Tokens stored in `integration_connections` under provider `youtube` with metadata.access_token / refresh_token
- Gmail/Drive currently flow through Maton gateway (`src/services/matonService.ts`, `supabase/functions/maton/index.ts`)

What "wire natively" requires:
1. **Add scopes to the existing OAuth flow**: `gmail.readonly`, `gmail.send`, `gmail.modify`, `drive.readonly`, `drive.file` (drive.readonly already there)
2. **Rename the connection** from `youtube` → `google` (since it's no longer YouTube-specific) OR keep as-is and treat the youtube connection as a shared Google token store
3. **Build native edge functions**: `google-gmail/index.ts` and `google-drive/index.ts` that read tokens from the same connection row and call Google APIs directly
4. **Wire chat tools**: register Gmail/Drive tools in the chat function pointing at native endpoints instead of Maton
5. **Build UI cards** in Integrations Hub (or unify under one "Google Workspace" card)

# Plan: Native Google Workspace (Gmail + Drive) via Existing OAuth

## Approach
Treat the existing YouTube OAuth as a unified **Google Workspace connection**. One token, multiple scopes, multiple service endpoints.

## Changes

### 1. `supabase/functions/youtube/index.ts` — expand OAuth scopes
Add to the authorize URL scope list:
- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.send`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/drive.file`

User must re-authorize once to grant new scopes.

### 2. New shared helper: `supabase/functions/_shared/google-token.ts`
- `getGoogleAccessToken(userId)` → reads from `integration_connections` (provider=`youtube`), auto-refreshes if expired using stored `refresh_token`, returns valid token
- Used by all Google native functions

### 3. New edge function: `supabase/functions/google-gmail/index.ts`
Actions: `list_messages`, `get_message`, `send_message`, `trash_message`, `list_labels`. Calls `gmail.googleapis.com/gmail/v1/...` directly.

### 4. New edge function: `supabase/functions/google-drive/index.ts`
Actions: `list_files`, `get_file`, `download_file`, `upload_file`, `search_files`. Calls `googleapis.com/drive/v3/...`.

### 5. Chat tools: `supabase/functions/chat/index.ts`
Register `gmail_*` and `drive_*` tool definitions that invoke the new functions. Keep Maton as fallback for users without OAuth.

### 6. Google Cloud Console (manual)
Enable in project 553189125514:
- Gmail API
- (Drive API — already required from previous step)

### 7. UI: `src/pages/integrations/YouTubeDetail.tsx` (rename or supplement)
- Rename header to "Google Workspace (YouTube + Gmail + Drive)" OR
- Add a new `/integrations/google` page that shows the same OAuth state with checkboxes for which services are active

## Tradeoffs vs Maton
Pros: no Maton dependency, no rate limits, faster, full API surface
Cons: you maintain the integration, must enable each Google API in Cloud Console, must handle token refresh, scope sprawl on one OAuth client

## Recommended sequence
Build Gmail first (highest value, replaces most Maton calls), verify, then Drive. Don't remove Maton until both are stable.

## What I need from you to proceed
1. Confirm: build Gmail + Drive native this turn (or just one)?
2. Confirm: keep connection name as `youtube` for now, or rename to `google` (rename = migration)?
3. Acknowledge you'll enable Gmail API in Cloud Console after deploy
