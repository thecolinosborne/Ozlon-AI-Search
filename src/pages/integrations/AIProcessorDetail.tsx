import { useState, useEffect, useCallback } from "react";
import { Cpu, Zap, Check, RefreshCw, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { SyncControl } from "@/components/integrations/SyncControl";
import { GauntletPanel } from "@/components/gauntlet/GauntletPanel";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

const providers = [
  { id: "openai", name: "OpenAI", description: "GPT-5.4, GPT-5, GPT-5 Mini" },
  { id: "gemini", name: "Gemini", description: "Gemini 2.5 Flash, Gemini 2.5 Pro" },
];

const models: Record<string, { id: string; name: string }[]> = {
  openai: [
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gpt-4.1", name: "GPT-4.1" },
    { id: "gpt-5", name: "GPT-5" },
    { id: "gpt-5-mini", name: "GPT-5 Mini" },
  ],
  gemini: [
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  ],
};

const AIProcessorDetail = () => {
  const { getIntegration, setStatus, updateSettings, setSyncDirection, setLastSync } = useIntegrationsStore();
  const integration = getIntegration("ai-processor");
  const settings = integration.settings as { provider?: string; model?: string };

  const activeProvider = settings.provider || "openai";
  const activeModel = settings.model || models[activeProvider]?.[0]?.id || "";

  const [verifiedProviders, setVerifiedProviders] = useState<Record<string, boolean | null>>({});
  const [syncing, setSyncing] = useState(false);

  const verifyProvider = useCallback(async (providerId: string) => {
    setVerifiedProviders((prev) => ({ ...prev, [providerId]: null }));
    try {
      const testModel = providerId === "gemini" ? "google/gemini-2.5-flash" : "gpt-5.4";
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey}`,
          apikey: anonKey,
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "ping" }],
          model: testModel,
        }),
      });
      setVerifiedProviders((prev) => ({ ...prev, [providerId]: response.ok }));
    } catch {
      setVerifiedProviders((prev) => ({ ...prev, [providerId]: false }));
    }
  }, []);

  const verifyAll = useCallback(async () => {
    setSyncing(true);
    await Promise.all(providers.map((p) => verifyProvider(p.id)));
    setSyncing(false);
    setLastSync("ai-processor", new Date().toISOString());
    const allVerified = providers.every((p) => verifiedProviders[p.id] === true);
    setStatus("ai-processor", allVerified ? "connected" : "error");
  }, [verifyProvider, verifiedProviders, setLastSync, setStatus]);

  useEffect(() => {
    providers.forEach((p) => verifyProvider(p.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    console.log("[AIProcessor] Providers:", providers.map((p) => p.id), "Verified:", verifiedProviders);
  }, [verifiedProviders]);

  const setProvider = (id: string) => {
    const firstModel = models[id]?.[0]?.id || "";
    updateSettings("ai-processor", { provider: id, model: firstModel });
    setStatus("ai-processor", "connected");
    toast.success(`AI Provider set to ${providers.find((p) => p.id === id)?.name}`);
  };

  const setModel = (modelId: string) => {
    updateSettings("ai-processor", { model: modelId });
  };

  const renderVerificationBadge = (providerId: string) => {
    const status = verifiedProviders[providerId];
    if (status === null || status === undefined) {
      return <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />;
    }
    if (status) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
          <CheckCircle2 className="w-3.5 h-3.5" /> Verified
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive">
        <XCircle className="w-3.5 h-3.5" /> Unverified
      </span>
    );
  };

  return (
    <IntegrationDetailLayout
      name="AI Processor"
      description="Configure AI providers, models, and routing"
      icon={Cpu}
      status={integration.status === "disconnected" ? "connected" : integration.status}
    >
      {/* AI Gauntlet — Auto router with hot-swappable stones */}
      <GauntletPanel />

      <div className="h-px bg-border/40 my-2" />

      {/* Provider Selection */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Provider</h3>
        <div className="space-y-2">
          {providers.map((provider) => (
            <button
              key={provider.id}
              onClick={() => setProvider(provider.id)}
              className={cn(
                "w-full flex items-center justify-between p-4 rounded-xl border transition-all text-left",
                activeProvider === provider.id
                  ? "border-primary/30 bg-primary/5"
                  : "border-border/40 bg-card/60 hover:border-border"
              )}
            >
              <div>
                <p className="text-sm font-medium text-foreground">{provider.name}</p>
                <p className="text-[11px] text-muted-foreground">{provider.description}</p>
              </div>
              <div className="flex items-center gap-2">
                {renderVerificationBadge(provider.id)}
                {activeProvider === provider.id && (
                  <div className="p-1 rounded-full bg-primary">
                    <Check className="w-3 h-3 text-primary-foreground" />
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Sync Control */}
      <SyncControl
        direction={integration.syncDirection}
        onDirectionChange={(d) => setSyncDirection("ai-processor", d)}
        lastSync={integration.lastSync}
        onSync={verifyAll}
        syncing={syncing}
      />

      {/* Model Selection */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Model</h3>
        <div className="space-y-2">
          {(models[activeProvider] || []).map((model) => (
            <button
              key={model.id}
              onClick={() => setModel(model.id)}
              className={cn(
                "w-full flex items-center justify-between p-3.5 rounded-xl border transition-all text-left",
                activeModel === model.id
                  ? "border-primary/30 bg-primary/5"
                  : "border-border/40 bg-card/60 hover:border-border"
              )}
            >
              <span className="text-sm font-medium text-foreground">{model.name}</span>
              {activeModel === model.id && (
                <Zap className="w-4 h-4 text-primary" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Fallback Routing */}
      <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-2">
        <h3 className="text-sm font-medium text-foreground">Fallback Routing</h3>
        <p className="text-xs text-muted-foreground">
          Automatic failover between providers will be available in a future update.
          Currently, all requests route to the selected provider.
        </p>
      </div>
    </IntegrationDetailLayout>
  );
};

export default AIProcessorDetail;
