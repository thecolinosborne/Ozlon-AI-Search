---
name: Gmail restricted scopes — never request without explicit approval
description: Hard ban on https://mail.google.com/ (full mailbox / hard delete) and gmail.settings.sharing (admin delegation)
type: constraint
---
**Never add these scopes to `supabase/functions/youtube/index.ts`:**
- `https://mail.google.com/` — full mailbox access including permanent delete. Forbidden by `mem://integrations/gmail-deletion-policy`. Use `POST /messages/{id}/trash` (covered by `gmail.modify`); Gmail auto-purges trash after 30 days.
- `https://www.googleapis.com/auth/gmail.settings.sharing` — admin delegation; high-risk, requires Google verification review.

**Why:** These trigger Google's restricted-scope verification process and expose users to irreversible data loss. The current scope bundle (see `mem://features/gmail-scope-bundle`) covers every supported product capability without them.

**If a future feature seems to need them:** stop, surface the request to the user explicitly with the risk explained, and only proceed after written approval.
