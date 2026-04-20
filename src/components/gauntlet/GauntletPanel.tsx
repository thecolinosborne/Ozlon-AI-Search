import { useState, useEffect } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { useGauntlet } from "@/hooks/useGauntlet";
import { StoneSlot } from "./StoneSlot";
import { AutoModeToggle } from "./AutoModeToggle";
import { UsageBreakdown } from "./UsageBreakdown";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const GauntletPanel = () => {
  const { providers, stones, usage, verifying, verifyAll, setMode, toggleStatus, ALL_STONES, keysDetected } = useGauntlet();
  const [globalMode, setGlobalMode] = useState<"auto" | "manual">("auto");

  // Derive global mode from any provider row (they share a mode)
  useEffect(() => {
    const m = providers.find((p) => p.mode)?.mode;
    if (m) setGlobalMode(m);
  }, [providers]);

  const handleModeChange = async (m: "auto" | "manual") => {
    setGlobalMode(m);
    // Apply to all providers
    for (const p of ALL_STONES) {
      await setMode(p, m);
    }
    toast.success(`Switched to ${m === "auto" ? "Auto" : "Manual"} mode`);
  };

  const handleVerify = async () => {
    await verifyAll();
    toast.success("Stones verified");
  };

  const providerMap = Object.fromEntries(providers.map((p) => [p.provider, p]));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">AI Gauntlet</h2>
        </div>
        <button
          onClick={handleVerify}
          disabled={verifying}
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
            "border border-border/40 hover:border-border bg-card/60 text-foreground transition-all",
            verifying && "opacity-50 cursor-not-allowed"
          )}
        >
          <RefreshCw className={cn("w-3 h-3", verifying && "animate-spin")} />
          {verifying ? "Verifying…" : "Verify all"}
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Each stone is an AI provider. In <strong>Auto</strong> mode, the system picks the best stone per task — vision goes to Gemini, heavy reasoning to GPT-5, fast classification to Flash. Add API keys to light up new stones.
      </p>

      {/* Keys-detected banner */}
      {keysDetected > 0 && (
        <div className="px-3 py-2 rounded-lg border border-primary/30 bg-primary/5 text-xs text-foreground">
          <strong className="text-primary">{keysDetected} {keysDetected === 1 ? "key" : "keys"} detected.</strong>{" "}
          Auto mode is picking the best stone per task. Your direct provider keys are the primary execution path.
        </div>
      )}

      {/* Mode toggle */}
      <AutoModeToggle mode={globalMode} onChange={handleModeChange} />

      {/* Stones grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ALL_STONES.map((p) => (
          <StoneSlot
            key={p}
            provider={p}
            row={providerMap[p]}
            capability={stones[p]}
            onToggle={toggleStatus}
          />
        ))}
      </div>

      {/* Usage breakdown */}
      <UsageBreakdown usage={usage} />

      {/* Not yet supported */}
      <p className="text-[11px] text-muted-foreground/70 pt-2 border-t border-border/30">
        <strong className="text-muted-foreground">Not yet supported:</strong> Groq, Mistral, DeepSeek. We'll add these as Brain Stones when there's demand.
      </p>
    </div>
  );
};
