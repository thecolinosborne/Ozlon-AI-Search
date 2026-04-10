import { Sparkles, Settings2 } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { SyncControl } from "@/components/integrations/SyncControl";
import { ApiKeyInput } from "@/components/integrations/ApiKeyInput";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { toast } from "sonner";

const HiggsFieldDetail = () => {
  const { getIntegration, setStatus, setSyncDirection, setLastSync, setApiKeyConfigured } = useIntegrationsStore();
  const integration = getIntegration("higgsfield");

  const handleSaveKey = (key: string) => {
    setApiKeyConfigured("higgsfield", true);
    setStatus("higgsfield", "connected");
    setLastSync("higgsfield", new Date().toISOString());
    toast.success("Higgsfield AI connected");
  };

  const handleDisconnect = () => {
    setStatus("higgsfield", "disconnected");
    setApiKeyConfigured("higgsfield", false);
    toast.success("Higgsfield AI disconnected");
  };

  return (
    <IntegrationDetailLayout
      name="Higgsfield AI"
      description="AI-powered video generation platform"
      icon={Sparkles}
      status={integration.status}
      actions={
        integration.status === "connected" ? (
          <button
            onClick={handleDisconnect}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
          >
            Disconnect
          </button>
        ) : undefined
      }
    >
      <ApiKeyInput
        label="Higgsfield API Key"
        configured={integration.apiKeyConfigured}
        onSave={handleSaveKey}
      />

      {integration.status === "connected" && (
        <>
          <SyncControl
            direction={integration.syncDirection}
            onDirectionChange={(d) => setSyncDirection("higgsfield", d)}
            lastSync={integration.lastSync}
          />

          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <h3 className="text-sm font-medium text-foreground">Model & Configuration</h3>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40">
              <Settings2 className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
              <div>
                <p className="text-sm font-medium text-foreground">Default Model</p>
                <p className="text-[11px] text-muted-foreground">Configuration will be available once connected</p>
              </div>
            </div>
          </div>
        </>
      )}
    </IntegrationDetailLayout>
  );
};

export default HiggsFieldDetail;
