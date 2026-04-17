import { freeToSpend, AccountRow, TxRow, SAFETY_BUFFER, totalAvailableCheckingBalance, estimateUpcomingBills } from "@/services/financeService";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export const FreeToSpendCard = ({ accounts, txs }: { accounts: AccountRow[]; txs: TxRow[] }) => {
  const value = freeToSpend(accounts, txs);
  const checking = totalAvailableCheckingBalance(accounts);
  const upcoming = estimateUpcomingBills(txs);

  return (
    <div className="rounded-3xl border border-border/40 bg-card/60 backdrop-blur-xl p-10 text-center shadow-sm">
      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">Free to spend</div>
      <div className="text-6xl md:text-7xl font-light tracking-tight text-foreground tabular-nums">
        {fmt(value)}
      </div>
      <div className="mt-6 flex items-center justify-center gap-6 text-xs text-muted-foreground">
        <span>Available {fmt(checking)}</span>
        <span className="opacity-40">·</span>
        <span>Upcoming {fmt(upcoming)}</span>
        <span className="opacity-40">·</span>
        <span>Buffer {fmt(SAFETY_BUFFER)}</span>
      </div>
    </div>
  );
};
