import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAccounts, useTransactions } from "@/hooks/useFinance";
import { totalCash, AccountRow, recentSpend } from "@/services/financeService";
import { FreeToSpendCard } from "@/components/finance/FreeToSpendCard";
import { AccountsList } from "@/components/finance/AccountsList";
import { TransactionsList } from "@/components/finance/TransactionsList";
import { ConnectionRow } from "@/components/finance/ConnectionRow";
import { PlaidLinkButton } from "@/components/finance/PlaidLinkButton";
import { Skeleton } from "@/components/ui/skeleton";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

interface ItemRow {
  id: string;
  institution_name: string | null;
  last_synced_at: string | null;
  last_error: string | null;
}

const Finance = () => {
  const accountsQ = useAccounts();
  const txsQ = useTransactions();
  const [items, setItems] = useState<ItemRow[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("plaid_items")
        .select("id, institution_name, last_synced_at, last_error")
        .order("created_at", { ascending: true });
      setItems((data as ItemRow[]) ?? []);
    })();
  }, [accountsQ.data]);

  const accounts: AccountRow[] = accountsQ.data ?? [];
  const txs = txsQ.data ?? [];
  const cash = useMemo(() => totalCash(accounts), [accounts]);
  const spend7 = useMemo(() => recentSpend(txs, 7), [txs]);

  const loading = accountsQ.isLoading;
  const empty = !loading && accounts.length === 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/70 border-b border-border/30">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <h1 className="text-sm font-medium text-foreground">Finance</h1>
          <div className="w-12" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-10">
        {loading && (
          <>
            <Skeleton className="h-48 rounded-3xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </>
        )}

        {empty && (
          <div className="rounded-3xl border border-border/40 bg-card/40 backdrop-blur-xl p-12 text-center">
            <h2 className="text-2xl font-light text-foreground mb-3">Connect your first account</h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-8">
              Securely link a bank to see balances, transactions, and your free-to-spend number in one private view.
            </p>
            <PlaidLinkButton className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity">
              <Plus className="w-4 h-4" />
              Connect an account
            </PlaidLinkButton>
          </div>
        )}

        {!loading && !empty && (
          <>
            {/* Hero */}
            <FreeToSpendCard accounts={accounts} txs={txs} />

            {/* Overview stats */}
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Total Cash" value={fmt(cash)} />
              <Stat label="Accounts" value={String(accounts.length)} />
              <Stat label="7d Spend" value={fmt(spend7)} />
            </div>

            {/* Accounts */}
            <section className="space-y-3">
              <SectionHeader title="Accounts" />
              <AccountsList accounts={accounts} />
            </section>

            {/* Transactions */}
            <section className="space-y-3">
              <SectionHeader title="Recent activity" />
              <TransactionsList transactions={txs} />
            </section>

            {/* Connections */}
            <section className="space-y-3">
              <SectionHeader title="Connections" />
              <div className="space-y-2">
                {items.map((it) => (
                  <ConnectionRow
                    key={it.id}
                    itemId={it.id}
                    institutionName={it.institution_name || "Bank"}
                    lastSyncedAt={it.last_synced_at}
                    hasError={!!it.last_error}
                  />
                ))}
              </div>
              <div className="pt-2">
                <PlaidLinkButton className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border/60 text-sm text-foreground hover:bg-muted/60 transition-colors">
                  <Plus className="w-4 h-4" />
                  Connect another account
                </PlaidLinkButton>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
};

const SectionHeader = ({ title }: { title: string }) => (
  <h2 className="text-xs uppercase tracking-[0.18em] text-muted-foreground px-1">{title}</h2>
);

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-xl px-4 py-4">
    <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground mb-1">{label}</div>
    <div className="text-lg font-medium text-foreground tabular-nums">{value}</div>
  </div>
);

export default Finance;
