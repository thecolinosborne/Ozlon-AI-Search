
The user is telling me they have THREE Plaid credentials: a `client_id`, a `production_secret`, AND a `sandbox_secret`. The current single `PLAID_SECRET` env var only holds one, and based on logs it doesn't match `PLAID_ENV=sandbox`. They likely pasted the production secret into `PLAID_SECRET`.

Best fix: store both secrets, pick the right one at runtime based on `PLAID_ENV`. This makes env switching (sandbox → production) a one-variable change.

## Plan

**Secrets** — keep `PLAID_CLIENT_ID` as is. Replace single `PLAID_SECRET` with two named secrets:
- `PLAID_SANDBOX_SECRET` — your Sandbox secret from the Plaid dashboard
- `PLAID_PRODUCTION_SECRET` — your Production secret
- (keep `PLAID_SECRET` as a legacy fallback so nothing breaks mid-rollout)

**Edge function** (`supabase/functions/plaid/index.ts`) — small, surgical change:
1. At startup, trim all Plaid env vars (strips invisible whitespace from paste).
2. Pick secret by env: `sandbox` → `PLAID_SANDBOX_SECRET`, `production` → `PLAID_PRODUCTION_SECRET`, fallback to `PLAID_SECRET`.
3. On any Plaid error, return HTTP 200 with `{ ok: false, error, diagnostics: { env, host, client_id_len, secret_len, secret_source } }` instead of HTTP 500. No secret values exposed.

**Service** (`src/services/financeService.ts`) — parse `{ ok: false, error }` envelope and surface the real Plaid error in the toast.

**UI** (`src/pages/Finance.tsx`) — show the precise error in the empty state instead of the generic "non-2xx" message.

**Verify** — call `create_link_token` directly via the deployed function, confirm it returns a real `link_token`, then test Connect end-to-end in preview.

After approval I'll request the two new secrets, ship the code, and verify.
