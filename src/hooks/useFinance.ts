import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { financeService, AccountRow, TxRow } from "@/services/financeService";

export function useAccounts() {
  return useQuery({
    queryKey: ["plaid", "accounts"],
    queryFn: async () => (await financeService.getAccounts()).accounts as AccountRow[],
  });
}

export function useTransactions(account_id?: string) {
  return useQuery({
    queryKey: ["plaid", "transactions", account_id ?? "all"],
    queryFn: async () => (await financeService.getTransactions({ account_id, limit: 100 })).transactions as TxRow[],
  });
}

export function useRefreshBalances() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => financeService.refreshBalances(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plaid", "accounts"] }),
  });
}

export function useSyncTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item_id?: string) => financeService.syncTransactions(item_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plaid", "transactions"] });
      qc.invalidateQueries({ queryKey: ["plaid", "accounts"] });
    },
  });
}

export function useDisconnectItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item_id: string) => financeService.disconnectItem(item_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plaid", "accounts"] });
      qc.invalidateQueries({ queryKey: ["plaid", "transactions"] });
    },
  });
}
