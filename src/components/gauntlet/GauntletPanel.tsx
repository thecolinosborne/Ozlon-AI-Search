import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Sparkles, Plus } from "lucide-react";
import { useGauntlet } from "@/hooks/useGauntlet";
import { StoneSlot } from "./StoneSlot";
import { ByokSlot, type ByokPlatform } from "./ByokSlot";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

// BYOK platforms NOT covered by system secrets — users plug in their own key
const BYOK_PLATFORMS: ByokPlatform[] = [
  {
    id: "anthropic",
    label: "Claude (your key)",
    blurb: "Anthropic's brain. Thoughtful, careful, great at long writing.",
    console_url: "https://console.anthropic.com/settings/keys",
    key_prefix: "sk-ant-",
  },
  {
    id: "xai",
    label: "Grok",
    blurb: "xAI's brain. Witty and up to the minute.",
    console_url: "https://console.x.ai",
    key_prefix: "xai-",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    blurb: "Budget-friendly brain. Strong reasoning at low cost.",
    console_url: "https://platform.deepseek.com/api_keys",
    key_prefix: "sk-",
  },
  {
    id: "mistral",
    label: "Mistral",
    blurb: "European brain. Fast, capable, privacy-minded.",
    console_url: "https://console.mistral.ai/api-keys",
    key_prefix: "",
  },
];

interface ByokStatus {
  id: string;
  connected: boolean;
  last4?: string;
  label?: string | null;
}

export const GauntletPanel = () => {
  const { providers, stones, verifying, verifyAll, ALL_STONES } = useGauntlet();
  const [byokStatus, setByokStatus] = useState<Record<string, ByokStatus>>({});

  const refreshByok = useCallback(async () => {
    const { data } = await supabase.functions.invoke("connect-brain", {
      body: { action: "list_status" },
    });
    const map: Record<string, ByokStatus> = {};
    for (const p of (data?.platforms ?? []) as Array<{ id: string; connected: boolean; last4?: string; nickname?: string | null }>) {
      map[p.id] = { id: p.id, connected: !!p.connected, last4: p.last4, label: p.nickname };
    }
    setByokStatus(map);
  }, []);

  useEffect(() => { refreshByok(); }, [refreshByok]);

  const handleVerify = async () => {
    await Promise.all([verifyAll(), refreshByok()]);
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

      {/* System keys — Connected */}
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
                verifying={verifying}
              />
            ))}
          </div>
        </div>
      )}

      {/* System keys — Available (waiting for env secret) */}
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
                verifying={verifying}
              />
            ))}
          </div>
        </div>
      )}

      {/* BYOK — bring your own key */}
      <div className="space-y-2 pt-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground px-1">
          <Plus className="w-3 h-3" />
          Bring your own key
        </div>
        <div className="space-y-2">
          {BYOK_PLATFORMS.map((p) => {
            const status = byokStatus[p.id];
            return (
              <ByokSlot
                key={p.id}
                platform={p}
                connected={!!status?.connected}
                last4={status?.last4}
                nickname={status?.label}
                onChanged={refreshByok}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
