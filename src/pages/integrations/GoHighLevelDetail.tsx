import { useState } from "react";
import { Globe, Users, GitBranch, MessageSquare } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { SyncControl } from "@/components/integrations/SyncControl";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface SubAccount {
  id: string;
  name: string;
  syncing: boolean;
}

const dataSyncOptions = [
  { key: "contacts", label: "Contacts", icon: Users },
  { key: "pipelines", label: "Pipelines", icon: GitBranch },
  { key: "conversations", label: "Conversations", icon: MessageSquare },
];

const GoHighLevelDetail = () => {
  const { getIntegration, setStatus, setSyncDirection, setLastSync, updateSettings } = useIntegrationsStore();
  const integration = getIntegration("gohighlevel");
  const settings = integration.settings as { subAccounts?: SubAccount[]; syncData?: Record<string, boolean> };

  const [selectedAccount, setSelectedAccount] = useState<string | null>(
    (settings.subAccounts?.[0]?.id) || null
  );

  const syncData = settings.syncData || { contacts: true, pipelines: true, conversations: false };

  const handleConnect = () => {
    setStatus("gohighlevel", "connected");
    setLastSync("gohighlevel", new Date().toISOString());
    updateSettings("gohighlevel", {
      subAccounts: [{ id: "default", name: "Primary Account", syncing: false }],
    });
    setSelectedAccount("default");
    toast.success("Go High Level connected");
  };

  const handleDisconnect = () => {
    setStatus("gohighlevel", "disconnected");
    updateSettings("gohighlevel", { subAccounts: [], syncData: {} });
    toast.success("Go High Level disconnected");
  };

  const toggleSyncData = (key: string) => {
    const updated = { ...syncData, [key]: !syncData[key] };
    updateSettings("gohighlevel", { syncData: updated });
  };

  const handleSync = async () => {
    setStatus("gohighlevel", "syncing");
    await new Promise((r) => setTimeout(r, 1500));
    setStatus("gohighlevel", "connected");
    setLastSync("gohighlevel", new Date().toISOString());
    toast.success("GHL data synced");
  };

  return (
    <IntegrationDetailLayout
      name="Go High Level"
      description="CRM platform with contacts, pipelines, and marketing"
      icon={Globe}
      status={integration.status}
      actions={
        integration.status === "connected" ? (
          <button
            onClick={handleDisconnect}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={handleConnect}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Connect
          </button>
        )
      }
    >
      <SyncControl
        direction={integration.syncDirection}
        onDirectionChange={(d) => setSyncDirection("gohighlevel", d)}
        lastSync={integration.lastSync}
        onSync={handleSync}
        syncing={integration.status === "syncing"}
      />

      {/* Sub-Accounts */}
      {settings.subAccounts && settings.subAccounts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Sub-Accounts</h3>
          <div className="space-y-2">
            {settings.subAccounts.map((acct) => (
              <button
                key={acct.id}
                onClick={() => setSelectedAccount(acct.id)}
                className={cn(
                  "w-full flex items-center justify-between p-3.5 rounded-xl border transition-all",
                  selectedAccount === acct.id
                    ? "border-primary/30 bg-primary/5"
                    : "border-border/40 bg-card/60 hover:border-border"
                )}
              >
                <span className="text-sm font-medium text-foreground">{acct.name}</span>
                {selectedAccount === acct.id && (
                  <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                    Active
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Data Sync Controls */}
      {integration.status === "connected" && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Data Sync</h3>
          <div className="space-y-2">
            {dataSyncOptions.map(({ key, label, icon: Icon }) => (
              <div
                key={key}
                className="flex items-center justify-between p-3.5 rounded-xl border border-border/40 bg-card/60"
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
                  <span className="text-sm font-medium text-foreground">{label}</span>
                </div>
                <button
                  onClick={() => toggleSyncData(key)}
                  className={cn(
                    "w-10 h-5.5 rounded-full p-0.5 transition-colors",
                    syncData[key] ? "bg-primary" : "bg-muted"
                  )}
                >
                  <div
                    className={cn(
                      "w-4.5 h-4.5 rounded-full bg-white transition-transform shadow-sm",
                      syncData[key] ? "translate-x-[18px]" : "translate-x-0"
                    )}
                    style={{ width: 18, height: 18 }}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </IntegrationDetailLayout>
  );
};

export default GoHighLevelDetail;
