
Surgical, additive change. No orchestrator, router, or chat function changes. Fully respects the existing `gmail-deletion-policy` (no hard delete).

### 1. Add 3 Gmail scopes to the shared Google authorize bundle
**File:** `supabase/functions/youtube/index.ts` (lines 799–801)

Add to the existing scope array:
- `https://www.googleapis.com/auth/gmail.compose` — drafts + compose
- `https://www.googleapis.com/auth/gmail.labels` — create/update/delete labels
- `https://www.googleapis.com/auth/gmail.settings.basic` — filters, signature, vacation responder

Keep all existing scopes (`gmail.readonly`, `gmail.send`, `gmail.modify`, drive, calendar, etc.) untouched.

**Explicitly excluded** (per memory rule):
- `https://mail.google.com/` (hard delete) — trash + Gmail's 30-day auto-purge stays the deletion path
- `https://www.googleapis.com/auth/gmail.settings.sharing` (admin delegation)

### 2. Update scope-gating UI logic
**File:** `src/lib/googleScopes.ts`

Update the `gmail` entry's `requiredScopes` to include the 3 new short suffixes (`gmail.compose`, `gmail.labels`, `gmail.settings.basic`) and refresh `scopeSummary` to: "Read, send, modify, compose, manage labels, filters, signature, and vacation responder."

### 3. Update Gmail detail page copy
**File:** `src/pages/integrations/GmailDetail.tsx`

Update `scopeNote` to reflect full management permissions.

### 4. Harden token helper against stale-cache after reauthorize
**File:** `supabase/functions/_shared/google-token.ts`

Add an exported `forceRefreshGoogleToken(userId)` helper that forces a refresh-token exchange regardless of cached `expires_at`, then updates metadata with the new token. Lets future callers recover from 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` without waiting for natural expiry.

### 5. Persist this decision to memory
Create:
- `mem://features/gmail-scope-bundle` — full scope list + flow: orchestrator → communication-agent → `google-gmail` edge function → `_shared/google-token.ts`. Scopes live in `supabase/functions/youtube/index.ts` (shared Google OAuth row, provider="youtube").
- `mem://constraints/gmail-restricted-scopes` — never add `https://mail.google.com/` or `gmail.settings.sharing` without explicit user approval. Cross-references `mem://integrations/gmail-deletion-policy`.

Update `mem://index.md` to reference both new memories.

### 6. Reauthorize Google connection
After deploy, you'll need to reauthorize once so Google grants the 3 new scopes. One click.

### Out of scope
- No changes to orchestrator, router, chat function, or any other Google service.
- No new edge functions.
- No changes to the deletion policy — trash only, no hard delete.
