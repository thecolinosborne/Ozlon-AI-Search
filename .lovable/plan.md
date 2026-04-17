
Focus: fix the cross-user integration leak. Defer Plaid.

## Root causes (confirmed)

1. **Frontend cache leak** — `src/stores/useIntegrationsStore.ts` persists to one global localStorage key `ozlon-integrations`. No user namespacing. Stale flags from a previous user render as "connected" for any subsequent signed-in user on the same browser.
2. **Backend env-fallback leak** — `higgsfield`, `clickup`, `descript`, `gohighlevel` edge functions, and GHL tools inside `chat`, fall back to global `Deno.env` secrets (`HIGGSFIELD_API_KEY`, `CLICKUP_API_TOKEN`, `DESCRIPT_API_KEY`, `GHL_API_KEY`/`GHL_LOCATION_ID`) when the signed-in user has no per-user `integration_connections` row. Any signed-in user effectively gets the project owner's keys.
3. **Hub trusts env-driven test** — `src/pages/Integrations.tsx` calls `higgsfield.test_connection` on mount, which returns success because of the env fallback, marking Higgsfield "connected" for everyone.
4. **Sign-out incomplete** — `AuthContext` clears app store but never removes `ozlon-integrations` from localStorage.

## Fix

**Backend (no env fallback for authenticated user actions):**
- `supabase/functions/higgsfield/index.ts`, `clickup/index.ts`, `descript/index.ts`, `gohighlevel/index.ts`: require auth header, resolve credentials only via per-user `integration_connections` + vault. Remove all `Deno.env.get('*_API_KEY')` fallbacks for user-facing actions. Return clear "not connected" error when missing.
  - Exception: keep env path ONLY for unauthenticated webhook entrypoints (e.g. ClickUp webhook handler) gated by a `webhook` action and signature/secret check — no JWT path.
- `supabase/functions/chat/index.ts`: GHL tool execution must read per-user GHL creds from `integration_connections`; if missing, return tool error "Connect GoHighLevel in Integrations" instead of silently using env keys.

**Frontend:**
- `src/stores/useIntegrationsStore.ts`: replace fixed `name: "ozlon-integrations"` with a dynamic, user-scoped key (`ozlon-integrations:<uid>`) using `createJSONStorage` + a `partialize`/`name` factory tied to the active user. Reset in-memory state on user change.
- `src/pages/Integrations.tsx`: remove the `higgsfield.test_connection` env-trusting auto-detect. Hydrate each card's status by querying `integration_connections` for the current `user.id` only. "Connected" requires a row with `status='connected'` for that user.
- `src/contexts/AuthContext.tsx`: in `clearAuthState`, also remove any `ozlon-integrations*` localStorage keys.

**Memory:**
- Update `mem://architecture/per-user-integration-credentials` to state: no env fallback for authenticated user actions; webhook-only env path is the sole exception.

## Verify after switch to default mode

1. Fresh incognito → sign up new test user → `/integrations` shows ALL cards disconnected.
2. From that account, ask chat to do a GHL action → response says "Connect GoHighLevel in Integrations", does not return owner's CRM data.
3. Sign in as primary account in another window → real connections still appear.
4. Sign out → `localStorage` has no `ozlon-integrations*` keys.
5. ClickUp webhook (external POST, no JWT) still processes — confirm via function logs.

## Files touched

- `supabase/functions/higgsfield/index.ts`
- `supabase/functions/clickup/index.ts`
- `supabase/functions/descript/index.ts`
- `supabase/functions/gohighlevel/index.ts`
- `supabase/functions/chat/index.ts` (GHL tool resolver only)
- `src/stores/useIntegrationsStore.ts`
- `src/pages/Integrations.tsx`
- `src/contexts/AuthContext.tsx`
- `mem://architecture/per-user-integration-credentials`

No DB schema changes. No Plaid changes in this pass.
