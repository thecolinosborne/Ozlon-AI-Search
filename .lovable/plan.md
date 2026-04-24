## Goal
Make the `google-gmail` edge function self-heal after Google scope changes, eliminating the manual reconnect dance after future scope expansions.

## Changes

### 1. `supabase/functions/google-gmail/index.ts` — refactor `gFetch`
- Change signature: `gFetch(token, path, init)` → `gFetch(userId, path, init, _retried = false)`
- Inside `gFetch`:
  - Call `getGoogleAccessToken(userId)` to obtain a fresh-enough token (helper already auto-refreshes near expiry).
  - On `403` with body containing `ACCESS_TOKEN_SCOPE_INSUFFICIENT` / `insufficient authentication scopes` / `insufficient permission`, OR on `401 invalid_token`: call `forceRefreshGoogleToken(userId)` and retry **exactly once** (`_retried` flag prevents loops).
  - If the second attempt still fails, throw a clear error instructing the user to reconnect Google in Integrations.
- Import `forceRefreshGoogleToken` from `../_shared/google-token.ts`.
- Remove the now-redundant `const token = await getGoogleAccessToken(userId);` line at the top of the `serve` handler (each `gFetch` call now owns token retrieval).
- Mechanically replace all `gFetch(token,` call sites (~35) with `gFetch(userId,`.

### 2. `.lovable/memory/features/gmail-scope-bundle.md` — append recovery flow
Add a short "Auto-recovery" section noting that `google-gmail`'s `gFetch` wrapper detects scope-403 and calls `forceRefreshGoogleToken` automatically, so newly granted Gmail scopes take effect on the very next call.

### 3. Deploy
Deploy the `google-gmail` edge function so the change is live.

## Out of scope
- No orchestrator, router, or chat function changes.
- No new scopes (those landed in the prior change).
- No changes to other Google services (gmail-only for now; pattern can be replicated later if needed).
- No changes to the deletion policy — still trash-only.

## Risk
Low. `gFetch` is the single chokepoint; signature change is mechanical. Retry is bounded to one attempt by `_retried` flag. On terminal failure, the error message is clearer than today's.
