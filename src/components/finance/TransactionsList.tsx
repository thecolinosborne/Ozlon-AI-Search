import { TxRow } from "@/services/financeService";

const fmtAmount = (n: number, ccy = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: ccy }).format(Math.abs(n));

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

export const TransactionsList = ({ transactions }: { transactions: TxRow[] }) => {
  if (transactions.length === 0) {
    return (
      <div className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-xl px-6 py-12 text-center text-sm text-muted-foreground">
        No transactions yet.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-xl divide-y divide-border/30">
      {transactions.map((t) => {
        const isCredit = t.amount < 0;
        return (
          <div key={t.id} className="flex items-center justify-between px-6 py-3.5">
            <div className="min-w-0 pr-4">
              <div className="text-sm font-medium text-foreground truncate">
                {t.merchant_name || t.name || "Transaction"}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {fmtDate(t.posted_date || t.authorized_date)}
                {t.category_primary ? ` · ${t.category_primary}` : ""}
                {t.pending ? " · Pending" : ""}
              </div>
            </div>
            <div className={`text-sm font-medium tabular-nums shrink-0 ${isCredit ? "text-emerald-500" : "text-foreground"}`}>
              {isCredit ? "+" : "−"}
              {fmtAmount(t.amount)}
            </div>
          </div>
        );
      })}
    </div>
  );
};
