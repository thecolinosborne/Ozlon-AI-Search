import { useState } from "react";
import { Cpu, Zap, Check } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { ApiKeyInput } from "@/components/integrations/ApiKeyInput";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const providers = [
  { id: "lovable", name: "Lovable AI", description: "Built-in AI gateway — no API key needed", requiresKey: false },
  { id: "openai", name: "OpenAI", description: "GPT-5, GPT-5-mini, and more", requiresKey: true },
  { id: "anthropic", name: "Anthropic", description: "Claude family of models", requiresKey: true },
];

const models: Record<string, { id: string; name: string }[]> = {
  lovable: [
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "openai/gpt-5-mini", name: "GPT-5 Mini" },
    { id: "openai/gpt-5", name: "GPT-5" },
  ],
  openai: [
    { id: "gpt-5", name: "GPT-5" },
    { id: "gpt-5-mini", name: "GPT-5 Mini" },
    { id: "gpt-5-nano", name: "GPT-5 Nano" },
  ],
  anthropic: [
    { id: "claude-sonnet", name: "Claude Sonnet" },
    { id: "claude-opus", name: "Claude Opus" },
  ],
};

const AIProcessorDetail = () => {
  const { getIntegration, setStatus, updateSettings, setApiKeyConfigured } = useIntegrationsStore();
  const integration = getIntegration("ai-processor");
  const settings = integration.settings as { provider?: string; model?: string; providerKeys?: Record<string, boolean> };

  const activeProvider = settings.provider || "lovable";
  const activeModel = settings.model || models[activeProvider]?.[0]?.id || "";
  const providerKeys = settings.providerKeys || {};

  const setProvider = (id: string) => {
    const firstModel = models[id]?.[0]?.id || "";
    updateSettings("ai-processor", { provider: id, model: firstModel });
    setStatus("ai-processor", "connected");
    toast.success(`AI Provider set to ${providers.find(p => p.id === id)?.name}`);
  };

  const setModel = (modelId: string) => {
    updateSettings("ai-processor", { model: modelId });
  };

  const handleSaveKey = (providerId: string, key: string) => {
    const updated = { ...providerKeys, [providerId]: true };
    updateSettings("ai-processor", { providerKeys: updated });
    setApiKeyConfigured("ai-processor", true);
    toast.success(`${providers.find(p => p.id === providerId)?.name} key saved`);
  };

  return (
    <IntegrationDetailLayout
      name="AI Processor"
      description="Configure AI providers, models, and routing"
      icon={Cpu}
      status={integration.status === "disconnected" ? "connected" : integration.status}
    >
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
              {activeProvider === provider.id && (
                <div className="p-1 rounded-full bg-primary">
                  <Check className="w-3 h-3 text-primary-foreground" />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* API Key for selected provider */}
      {providers.find(p => p.id === activeProvider)?.requiresKey && (
        <ApiKeyInput
          label={`${providers.find(p => p.id === activeProvider)?.name} API Key`}
          configured={!!providerKeys[activeProvider]}
          onSave={(key) => handleSaveKey(activeProvider, key)}
        />
      )}

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
