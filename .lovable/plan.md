

User is furious that Maton is referenced anywhere. Per memory, Maton WAS the gateway for 12 Google services. User wants it completely purged — every Google service must be called natively with the user's own OAuth tokens (already wired via `_shared/google-token.ts`), and every code path, prompt, label, comment, doc, and memory entry mentioning "Maton" must go.

## Audit (read-only confirmed pattern)
Maton references almost certainly live in:
- `supabase/functions/chat/index.ts` — tool definitions, system prompt, gateway URLs (`maton.ai` or similar), `MATON_ACTION_TOOLS`
- `supabase/functions/google-*` edge functions (gmail, calendar, drive, docs, sheets, slides, search-console, analytics, tag-manager) — may proxy through Maton
- `docs/`, `README.md`
- Memory files: `mem://integrations/maton-*` (4 entries), plus references in `index.md`

## Plan

### 1. Purge Maton from chat edge function
`supabase/functions/chat/index.ts`
- Remove every Maton tool definition, every `MATON_*` constant, every gateway URL.
- Replace each Google tool with a direct call to the corresponding existing `supabase/functions/google-*` edge function (which already uses the user's OAuth via `_shared/google-token.ts`).
- Strip "Maton" from the system prompt, tool descriptions, and any user-visible strings.

### 2. Purge Maton from Google edge functions
Each `supabase/functions/google-{gmail,calendar,drive,docs,sheets,slides,search-console,analytics,tag-manager}/index.ts`:
- Confirm they call Google APIs directly with the user's OAuth token (per `per-user-integration-credentials` memory — they already do).
- Remove any leftover Maton URL, header, comment, or fallback path.

### 3. Purge Maton from docs + README
- Grep `docs/` and `README.md` for Maton, replace with "Google (native OAuth)".

### 4. Purge Maton from memory
- Delete: `mem://integrations/maton-api-gateway`, `mem://integrations/maton-chat-logic`, `mem://integrations/maton-gateway-constraints`, `mem://integrations/maton-binary-file-transfer`.
- Update `mem://index.md` to drop those four lines and rename email/identity entries that reference Maton.
- Add new memory `mem://integrations/native-google-oauth` describing the direct-OAuth model.

### 5. Verify
After edits, grep the entire repo for `maton|Maton|MATON` — must return zero matches outside the migration history. Run a chat probe ("list my 3 newest emails") and confirm it routes to `google-gmail` directly.

## Files touched
- `supabase/functions/chat/index.ts` (major)
- `supabase/functions/google-*/index.ts` (cleanup pass on all 9)
- `README.md`, `docs/youtube-integration-v1-contract.md` (if referenced)
- `mem://integrations/maton-*` (delete 4) + `mem://index.md` + new `mem://integrations/native-google-oauth`

## Constraints honored
Additive to functionality (Google services keep working via existing native edge functions), purely subtractive on Maton. No UI changes. RLS unchanged. User OAuth flow already in place.

