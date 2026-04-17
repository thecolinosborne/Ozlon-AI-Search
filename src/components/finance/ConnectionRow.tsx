import { RefreshCw, Wrench, Trash2 } from "lucide-react";
import { PlaidLinkButton } from "./PlaidLinkButton";
import { useDisconnectItem, useSyncTransactions } from "@/hooks/useFinance";

interface Props {
  itemId: string;
  institutionName: string;
  lastSyncedAt: string | null;
  hasError: boolean;
}

export const ConnectionRow = ({ itemId, institutionName, lastSyncedAt, hasError }: Props) => {
  const sync = useSyncTransactions();
  const disconnect = useDisconnectItem();

  return (
    <div className="flex items-center justify-between px-6 py-4 rounded-2xl border border-border/40 bg-card/40 backdrop-blur-xl">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{institutionName}</div>
        <div className="text-xs text-muted-foreground">
          {hasError
            ? "Reconnect required"
            : lastSyncedAt
            ? `Synced ${new Date(lastSyncedAt).toLocaleString()}`
            : "Not synced yet"}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => sync.mutate(itemId)}
          disabled={sync.isPending}
          className="p-2 rounded-full hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${sync.isPending ? "animate-spin" : ""}`} />
        </button>
        <PlaidLinkButton
          mode="update"
          itemId={itemId}
          className="p-2 rounded-full hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Wrench className="w-4 h-4" />
        </PlaidLinkButton>
        <button
          onClick={() => {
            if (confirm(`Disconnect ${institutionName}? All synced data will be removed.`)) {
              disconnect.mutate(itemId);
            }
          }}
          disabled={disconnect.isPending}
          className="p-2 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          title="Disconnect"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
