import { ArrowLeftRight, ArrowDownToLine, ArrowUpFromLine, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SyncDirection } from "@/stores/useIntegrationsStore";

interface SyncControlProps {
  direction: SyncDirection;
  onDirectionChange: (d: SyncDirection) => void;
  lastSync: string | null;
  onSync?: () => void;
  syncing?: boolean;
}

const directions: { value: SyncDirection; label: string; icon: typeof ArrowLeftRight }[] = [
  { value: "two-way", label: "Two-way", icon: ArrowLeftRight },
  { value: "inbound", label: "Inbound", icon: ArrowDownToLine },
  { value: "outbound", label: "Outbound", icon: ArrowUpFromLine },
];

export const SyncControl = ({ direction, onDirectionChange, lastSync, onSync, syncing }: SyncControlProps) => (
  <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-4">
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-medium text-foreground">Sync Direction</h3>
      {onSync && (
        <button
          onClick={onSync}
          disabled={syncing}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full",
            "bg-primary/10 text-primary hover:bg-primary/20 transition-colors",
            syncing && "opacity-50 cursor-not-allowed"
          )}
        >
          <RefreshCw className={cn("w-3 h-3", syncing && "animate-spin")} />
          {syncing ? "Syncing…" : "Sync Now"}
        </button>
      )}
    </div>

    <div className="flex gap-2">
      {directions.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          onClick={() => onDirectionChange(value)}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all",
            direction === value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "bg-muted/60 text-muted-foreground hover:bg-muted"
          )}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </button>
      ))}
    </div>

    {lastSync && (
      <p className="text-[11px] text-muted-foreground/60">
        Last synced: {new Date(lastSync).toLocaleString()}
      </p>
    )}
  </div>
);
