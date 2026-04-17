
Edge function logs show: `invalid client_id or secret provided` from Plaid. Secrets `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` are all set in Supabase, but Plaid is rejecting them. This is a credential value problem, not a code problem.

Most common causes (in order):
1. `PLAID_CLIENT_ID` or `PLAID_SECRET` has a stray space / newline / wrong value pasted.
2. `PLAID_ENV` is set to `sandbox` but the secret pasted is the **production** secret (Plaid issues a different secret per environment — sandbox, development, production each have their own).
3. Values were swapped (client_id pasted into secret slot or vice versa).

I can't read secret values, so I can't diff them myself. Fastest path: re-enter the three values, making sure the secret matches the env.

## Plan

1. Confirm in the Plaid dashboard (https://dashboard.plaid.com/developers/keys) which environment you intend to use and copy the matching **client_id** and **Sandbox secret** (the page shows separate secrets per env).
2. Re-save the three secrets in Lovable Cloud:
   - `PLAID_CLIENT_ID` — the one client_id from the keys page
   - `PLAID_SECRET` — the secret matching `PLAID_ENV` (use the Sandbox secret if `PLAID_ENV=sandbox`)
   - `PLAID_ENV` — `sandbox` (recommended for first test)
3. Once re-saved, click **Connect an account** again on `/finance`. The edge function will pick up the new values on cold start.
4. If it still fails, I'll switch to default mode, tail the edge function logs, and surface the precise Plaid error_code in the UI so we can pinpoint mismatch vs. allowlist vs. product scope.

No code changes needed yet — this is a secret-value fix. Want me to also add a small "Diagnostics" line to the Finance empty state that surfaces the raw Plaid error message instead of the generic 500, so future credential issues are obvious without checking logs?
