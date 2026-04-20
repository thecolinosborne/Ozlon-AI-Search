import { RefreshCw, Sparkles } from "lucide-react";
import { useGauntlet } from "@/hooks/useGauntlet";
import { StoneSlot } from "./StoneSlot";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Which stones have a system-level project secret (env key). Drives the "Available · system key" affordance.
const SYSTEM_AVAILABLE: Record<string, boolean> = {
  lovable: true,
  openai: true,
  gemini: true,
  higgsfield: true,
  // BYOK-only platforms (no system secret expected)
  anthropic: false,
  xai: false,
  deepseek: false,
  mistral: false,
};

export const GauntletPanel = () => {
  const { providers, stones, userKeys, verifying, verifyAll, refresh, ALL_STONES } = useGauntlet();

  const handleVerify = async () => {
    await verifyAll();
    toast.success("Keys re-verified");
  };

  const providerMap = Object.fromEntries(providers.map((p) => [p.provider, p]));

  return (
    <div className="space-y-5">
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

      <div className="space-y-2">
        {ALL_STONES.map((p) => (
          <StoneSlot
            key={p}
            provider={p}
            row={providerMap[p]}
            capability={stones[p]}
            userKey={userKeys[p]}
            systemAvailable={SYSTEM_AVAILABLE[p] ?? false}
            verifying={verifying}
            onChanged={refresh}
          />
        ))}
      </div>
    </div>
  );
};
