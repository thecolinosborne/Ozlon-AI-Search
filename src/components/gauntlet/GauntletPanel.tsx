import { RefreshCw, Sparkles } from "lucide-react";
import { useGauntlet } from "@/hooks/useGauntlet";
import { StoneSlot } from "./StoneSlot";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const GauntletPanel = () => {
  const { providers, stones, verifying, verifyAll, ALL_STONES } = useGauntlet();

  const handleVerify = async () => {
    await verifyAll();
    toast.success("Keys re-verified");
  };

  const providerMap = Object.fromEntries(providers.map((p) => [p.provider, p]));

  const connected = ALL_STONES.filter((p) => providerMap[p]?.status === "active");
  const available = ALL_STONES.filter((p) => providerMap[p]?.status !== "active");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">AI Brain</h2>
        </div>
        <button
          onClick={handleVerify}
          disabled={verifying}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
            "border border-border/40 hover:border-border bg-card/60 text-foreground transition-all",
            verifying && "opacity-50 cursor-not-allowed",
          )}
        >
          <RefreshCw className={cn("w-3 h-3", verifying && "animate-spin")} />
          {verifying ? "Verifying…" : "Re-verify all"}
        </button>
      </div>

      {/* Connected */}
      {connected.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground px-1">
            Connected ({connected.length})
          </div>
          <div className="space-y-2">
            {connected.map((p) => (
              <StoneSlot
                key={p}
                provider={p}
                row={providerMap[p]}
                capability={stones[p]}
                connected
              />
            ))}
          </div>
        </div>
      )}

      {/* Available */}
      {available.length > 0 && (
        <div className="space-y-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground px-1">
            Available ({available.length})
          </div>
          <div className="space-y-2">
            {available.map((p) => (
              <StoneSlot
                key={p}
                provider={p}
                row={providerMap[p]}
                capability={stones[p]}
                connected={false}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
