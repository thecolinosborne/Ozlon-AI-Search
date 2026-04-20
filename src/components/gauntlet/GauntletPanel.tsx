import { RefreshCw, Sparkles, History, Zap, Scale, Gem } from "lucide-react";
import { useGauntlet, type GauntletMode } from "@/hooks/useGauntlet";
import { StoneSlot } from "./StoneSlot";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useState } from "react";

// Which stones have a system-level project secret. Drives the "Available · system key" affordance.
const SYSTEM_AVAILABLE: Record<string, boolean> = {
  lovable: true,
  openai: true,
  gemini: true,
  higgsfield: true,
  anthropic: false,
  xai: false,
  deepseek: false,
  mistral: false,
};

const MODES: { id: GauntletMode; label: string; icon: typeof Zap; hint: string }[] = [
  { id: "speed",    label: "Speed",    icon: Zap,   hint: "Cheapest capable stone" },
  { id: "balanced", label: "Balanced", icon: Scale, hint: "Cost vs quality auto" },
  { id: "quality",  label: "Quality",  icon: Gem,   hint: "Best stone regardless of cost" },
];

function fmtAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const GauntletPanel = () => {
  const { providers, stones, userKeys, verifying, verifyAll, refresh, ALL_STONES, recentDecisions, mode, setMode } = useGauntlet();
  const [historyOpen, setHistoryOpen] = useState(false);

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

      {/* Routing mode toggle */}
      <div className="rounded-xl border border-border/40 bg-card/40 p-3 space-y-2">
        <div className="text-xs font-medium text-foreground/70">Routing budget</div>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => {
                  setMode(m.id);
                  toast.success(`Routing mode: ${m.label}`);
                }}
                className={cn(
                  "flex flex-col items-start gap-1 px-3 py-2 rounded-lg border text-left transition-all",
                  active
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border/40 bg-card/40 text-muted-foreground hover:text-foreground hover:border-border",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5" />
                  <span className="text-xs font-semibold">{m.label}</span>
                </div>
                <span className="text-[10px] opacity-70">{m.hint}</span>
              </button>
            );
          })}
        </div>
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

      {/* Recent routing decisions */}
      <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-border/40 bg-card/40 hover:border-border transition-all">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground/80">
              <History className="w-3.5 h-3.5" />
              Recent routing decisions
              <span className="text-muted-foreground">({recentDecisions.length})</span>
            </div>
            <span className="text-[10px] text-muted-foreground">
              {historyOpen ? "Hide" : "Show"}
            </span>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <div className="space-y-1 rounded-lg border border-border/40 bg-card/20 p-2 max-h-80 overflow-y-auto">
            {recentDecisions.length === 0 ? (
              <p className="text-[11px] text-muted-foreground px-2 py-3 text-center">
                No routing decisions yet. Send a chat message to see one here.
              </p>
            ) : (
              recentDecisions.map((d) => (
                <div
                  key={d.id}
                  className="px-2 py-1.5 rounded text-[11px] grid grid-cols-[auto_auto_1fr_auto] gap-2 items-center hover:bg-muted/40"
                >
                  <span className="text-muted-foreground tabular-nums">{fmtAgo(d.created_at)}</span>
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-medium",
                    d.success ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive",
                  )}>
                    {d.modality ?? "text"}
                  </span>
                  <span className="text-foreground/80 truncate">
                    <span className="font-medium">{d.chosen_stone}</span>
                    {d.chosen_model && <span className="text-muted-foreground"> · {d.chosen_model}</span>}
                    {d.reason && <span className="text-muted-foreground"> — {d.reason}</span>}
                    {d.fallback_used && <span className="ml-1 text-foreground/60">↻ fallback</span>}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {d.latency_ms ? `${d.latency_ms}ms` : "—"}
                  </span>
                </div>
              ))
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};
