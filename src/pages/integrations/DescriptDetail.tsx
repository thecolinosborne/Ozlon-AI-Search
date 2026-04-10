import { Video, FolderOpen } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { SyncControl } from "@/components/integrations/SyncControl";
import { ApiKeyInput } from "@/components/integrations/ApiKeyInput";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { toast } from "sonner";

const DescriptDetail = () => {
  const { getIntegration, setStatus, setSyncDirection, setLastSync, setApiKeyConfigured } = useIntegrationsStore();
  const integration = getIntegration("descript");

  const handleSaveKey = (key: string) => {
    setApiKeyConfigured("descript", true);
    setStatus("descript", "connected");
    setLastSync("descript", new Date().toISOString());
    toast.success("Descript API key saved");
  };

  const handleDisconnect = () => {
    setStatus("descript", "disconnected");
    setApiKeyConfigured("descript", false);
    toast.success("Descript disconnected");
  };

  return (
    <IntegrationDetailLayout
      name="Descript"
      description="Video and podcast editing platform"
      icon={Video}
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
        label="Descript API Key"
        configured={integration.apiKeyConfigured}
        onSave={handleSaveKey}
      />

      {integration.status === "connected" && (
        <>
          <SyncControl
            direction={integration.syncDirection}
            onDirectionChange={(d) => setSyncDirection("descript", d)}
            lastSync={integration.lastSync}
          />

          {/* Workspace Info */}
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <h3 className="text-sm font-medium text-foreground">Workspace</h3>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40">
              <FolderOpen className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
              <div>
                <p className="text-sm font-medium text-foreground">Connected Workspace</p>
                <p className="text-[11px] text-muted-foreground">Projects and media files will sync automatically</p>
              </div>
            </div>
          </div>
        </>
      )}
    </IntegrationDetailLayout>
  );
};

export default DescriptDetail;
