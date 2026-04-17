-- plaid_items: one row per linked institution
CREATE TABLE public.plaid_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  connection_id UUID REFERENCES public.integration_connections(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL UNIQUE,
  institution_id TEXT,
  institution_name TEXT,
  cursor TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_plaid_items_user ON public.plaid_items(user_id);

ALTER TABLE public.plaid_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own plaid items" ON public.plaid_items FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own plaid items" ON public.plaid_items FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own plaid items" ON public.plaid_items FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own plaid items" ON public.plaid_items FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access plaid_items" ON public.plaid_items FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_plaid_items_updated BEFORE UPDATE ON public.plaid_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- plaid_accounts
CREATE TABLE public.plaid_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  plaid_item_id UUID NOT NULL REFERENCES public.plaid_items(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL UNIQUE,
  name TEXT,
  official_name TEXT,
  mask TEXT,
  type TEXT,
  subtype TEXT,
  current_balance NUMERIC,
  available_balance NUMERIC,
  iso_currency_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_plaid_accounts_user ON public.plaid_accounts(user_id);
CREATE INDEX idx_plaid_accounts_item ON public.plaid_accounts(plaid_item_id);

ALTER TABLE public.plaid_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own plaid accounts" ON public.plaid_accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own plaid accounts" ON public.plaid_accounts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own plaid accounts" ON public.plaid_accounts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own plaid accounts" ON public.plaid_accounts FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access plaid_accounts" ON public.plaid_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_plaid_accounts_updated BEFORE UPDATE ON public.plaid_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- plaid_transactions
CREATE TABLE public.plaid_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  plaid_item_id UUID NOT NULL REFERENCES public.plaid_items(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL UNIQUE,
  merchant_name TEXT,
  name TEXT,
  amount NUMERIC NOT NULL,
  iso_currency_code TEXT,
  category_primary TEXT,
  category_detailed TEXT,
  authorized_date DATE,
  posted_date DATE,
  pending BOOLEAN DEFAULT false,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_plaid_tx_user_date ON public.plaid_transactions(user_id, posted_date DESC);
CREATE INDEX idx_plaid_tx_item ON public.plaid_transactions(plaid_item_id);
CREATE INDEX idx_plaid_tx_account ON public.plaid_transactions(account_id);

ALTER TABLE public.plaid_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own plaid transactions" ON public.plaid_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own plaid transactions" ON public.plaid_transactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own plaid transactions" ON public.plaid_transactions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own plaid transactions" ON public.plaid_transactions FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access plaid_transactions" ON public.plaid_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_plaid_tx_updated BEFORE UPDATE ON public.plaid_transactions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();