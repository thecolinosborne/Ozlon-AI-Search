import { AccountRow } from "@/services/financeService";

const fmt = (n: number | null, ccy = "USD") =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: ccy }).format(n);

export const AccountsList = ({ accounts }: { accounts: AccountRow[] }) => {
  if (accounts.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-xl divide-y divide-border/30">
      {accounts.map((a) => (
        <div key={a.id} className="flex items-center justify-between px-6 py-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate">
              {a.plaid_items?.institution_name || "Bank"} · {a.name}
            </div>
            <div className="text-xs text-muted-foreground">
              ••{a.mask ?? "—"} · {a.subtype ?? a.type ?? "account"}
            </div>
          </div>
          <div className="text-right shrink-0 ml-4">
            <div className="text-sm font-medium text-foreground tabular-nums">
              {fmt(a.current_balance, a.iso_currency_code ?? "USD")}
            </div>
            {a.available_balance != null && a.available_balance !== a.current_balance && (
              <div className="text-xs text-muted-foreground tabular-nums">
                {fmt(a.available_balance, a.iso_currency_code ?? "USD")} available
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
