
User wants the Finance entry point in the top-right user menu (UserMenu dropdown), NOT the bottom nav. Everything else from the prior plan stands.

## Updated plan: Plaid-powered Finance layer

### Single entry point (revised)
- Add a **"Finance"** item to `src/components/UserMenu.tsx` dropdown (between Profile and Settings, with a wallet icon), linking to `/finance`.
- Do NOT touch BottomNav. No other placements anywhere.

### Everything else unchanged from prior plan
- **DB migration:** `plaid_items`, `plaid_accounts`, `plaid_transactions` — RLS scoped to `auth.uid() = user_id`.
- **Edge function** `supabase/functions/plaid/index.ts` with action router: `create_link_token`, `exchange_public_token`, `accounts`, `balances`, `transactions`, `sync_transactions`, `update_link_token`, `disconnect_item`. Access tokens stored encrypted via existing `store_user_secret` / `get_user_secret` vault. Audit-logs every connect/sync/repair/disconnect/failure.
- **Frontend (new files only):**
  - `src/pages/Finance.tsx` — Apple-minimal dashboard: Free-to-Spend hero, Overview stats, Accounts list, Transactions list, Connection management (refresh/repair/disconnect).
  - `src/pages/PlaidOAuthReturn.tsx` at `/finance/oauth-return` — handles OAuth re-entry via `receivedRedirectUri`.
  - `src/components/finance/{PlaidLinkButton,FreeToSpendCard,AccountsList,TransactionsList,ConnectionRow}.tsx`
  - `src/hooks/useFinance.ts`, `src/services/financeService.ts`
- **Free-to-Spend formula:** `available_checking - upcoming_bills_estimate - 200`. `estimateUpcomingBills()` returns 0 today; structured for later recurring detection without UI changes.
- **Dependency:** `react-plaid-link`.
- **Secrets requested after approval:** `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (default `sandbox`). Redirect URI derived from request origin + `/finance/oauth-return`. `VAULT_ENCRYPTION_KEY` already exists.
- **Routes added in `src/App.tsx`:** `/finance` and `/finance/oauth-return`.

### Files touched
- **New:** migration, plaid edge function, Finance page + OAuth return page, 5 finance components, hook, service.
- **Edited (minimal):** `src/components/UserMenu.tsx` (add Finance item), `src/App.tsx` (add 2 routes), `package.json` (add `react-plaid-link`).
- **NOT touched:** BottomNav, chat, home, onboarding.

After approval I'll request the three Plaid secrets, then ship migration + edge function + UI in one pass and verify with a sandbox connection.
