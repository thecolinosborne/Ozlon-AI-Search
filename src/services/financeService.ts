import { supabase } from "@/integrations/supabase/client";

async function call<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("plaid", { body: { action, ...body } });
  if (error) throw new Error(error.message);
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export const financeService = {
  createLinkToken: (opts?: { mode?: "create" | "update"; item_id?: string; redirect_uri?: string }) =>
    call<{ link_token: string }>("create_link_token", opts ?? {}),
  exchangePublicToken: (public_token: string, metadata: any) =>
    call<{ ok: true; item_id: string; institution_name?: string }>("exchange_public_token", { public_token, metadata }),
  getAccounts: () => call<{ accounts: any[] }>("accounts"),
  refreshBalances: () => call<{ accounts: any[] }>("balances"),
  getTransactions: (opts?: { account_id?: string; limit?: number }) =>
    call<{ transactions: any[] }>("transactions", opts ?? {}),
  syncTransactions: (item_id?: string) =>
    call<{ ok: true; added: number; modified: number; removed: number }>("sync_transactions", item_id ? { item_id } : {}),
  updateLinkToken: (item_id: string, redirect_uri?: string) =>
    call<{ link_token: string }>("update_link_token", { item_id, redirect_uri }),
  disconnectItem: (item_id: string) => call<{ ok: true }>("disconnect_item", { item_id }),
};

// ---- derived metrics ----
export interface AccountRow {
  id: string;
  account_id: string;
  plaid_item_id: string;
  name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string | null;
  plaid_items?: { institution_name: string | null; status: string };
}

export interface TxRow {
  id: string;
  account_id: string;
  merchant_name: string | null;
  name: string | null;
  amount: number;
  category_primary: string | null;
  posted_date: string | null;
  authorized_date: string | null;
  pending: boolean;
}

export const SAFETY_BUFFER = 200;

/**
 * Estimate upcoming bills from transactions. Today returns 0; this is the
 * single seam to upgrade later (recurring detection) without UI changes.
 */
export function estimateUpcomingBills(_txs: TxRow[]): number {
  return 0;
}

export function totalAvailableCheckingBalance(accounts: AccountRow[]): number {
  return accounts
    .filter((a) => a.type === "depository" && (a.subtype === "checking" || a.subtype === null))
    .reduce((sum, a) => sum + (a.available_balance ?? a.current_balance ?? 0), 0);
}

export function totalCash(accounts: AccountRow[]): number {
  return accounts
    .filter((a) => a.type === "depository")
    .reduce((sum, a) => sum + (a.current_balance ?? 0), 0);
}

export function freeToSpend(accounts: AccountRow[], txs: TxRow[]): number {
  const checking = totalAvailableCheckingBalance(accounts);
  const upcoming = estimateUpcomingBills(txs);
  return checking - upcoming - SAFETY_BUFFER;
}

export function recentSpend(txs: TxRow[], days = 7): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return txs
    .filter((t) => t.posted_date && new Date(t.posted_date) >= cutoff && t.amount > 0)
    .reduce((s, t) => s + t.amount, 0);
}
