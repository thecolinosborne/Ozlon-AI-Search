---
name: Gmail OAuth scope bundle
description: Full Gmail scope set granted via shared Google OAuth — read, send, modify, compose, labels, settings.basic — and how it flows through the orchestrator
type: feature
---
**Granted Gmail scopes** (shared Google OAuth, provider="youtube" row):
- `gmail.readonly` — read messages/threads/labels/drafts
- `gmail.send` — send mail
- `gmail.modify` — mark read/unread, archive, trash/untrash, apply labels
- `gmail.compose` — create/update drafts
- `gmail.labels` — create/update/delete labels
- `gmail.settings.basic` — filters, signature, vacation responder

**Where defined:** `supabase/functions/youtube/index.ts` `oauth_authorize` action. Single shared OAuth grant powers all Google services.

**Scope-gating UI:** `src/lib/googleScopes.ts` — substring match on granted scope string (persisted in `integration_connections.metadata.scope`).

**Orchestration flow:**
1. User chat → `chat` edge function → Infinity Router → communication-agent
2. Agent calls `google-gmail` edge function with user JWT
3. `google-gmail` calls `getGoogleAccessToken(userId)` from `_shared/google-token.ts`
4. Helper auto-refreshes via `YOUTUBE_CLIENT_ID/SECRET` if `expires_at` near
5. After scope changes / 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT, use `forceRefreshGoogleToken(userId)` to bypass cache

**Always keep this in mind:** Any new Gmail capability must (a) check scope is in this bundle, (b) if not, add scope to `youtube/index.ts` AND `googleScopes.ts`, (c) never request `https://mail.google.com/` (see `mem://constraints/gmail-restricted-scopes`).
