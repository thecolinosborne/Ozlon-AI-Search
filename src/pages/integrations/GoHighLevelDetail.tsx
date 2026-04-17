import { useState, useEffect } from "react";
import { Globe, Users, GitBranch, MessageSquare } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { ApiKeyInput } from "@/components/integrations/ApiKeyInput";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { upsertIntegrationConnection, disconnectIntegration } from "@/services/integrationConnectionService";
import { supabase } from "@/integrations/supabase/client";

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
  const { getIntegration, setStatus, setLastSync, updateSettings, setApiKeyConfigured } = useIntegrationsStore();
  const integration = getIntegration("gohighlevel");
  const settings = integration.settings as { subAccounts?: SubAccount[]; syncData?: Record<string, boolean>; apiKey?: string; locationId?: string };
  const [loading, setLoading] = useState(true);
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [savingLocationId, setSavingLocationId] = useState(false);
  const [testing, setTesting] = useState(false);

  const [selectedAccount, setSelectedAccount] = useState<string | null>(
    (settings.subAccounts?.[0]?.id) || null
  );

  const callGHL = async (action: string, params?: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("gohighlevel", {
      body: { action, params: { ...params } },
    });
    if (error) throw new Error(error.message || "Request failed");
    if (data?.error) throw new Error(data.error);
    return data;
  };

  // Auto-detect GHL connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      try {
        await callGHL("list_contacts", { limit: 1 });
        setStatus("gohighlevel", "connected");
        setApiKeyConfigured("gohighlevel", true);
        setLastSync("gohighlevel", new Date().toISOString());
        if (!settings.subAccounts?.length) {
          updateSettings("gohighlevel", {
            ...settings,
            subAccounts: [{ id: "default", name: "Primary Account", syncing: false }],
            syncData: { contacts: true, pipelines: true, conversations: true },
          });
          setSelectedAccount("default");
        }
      } catch {
        // silently fail — stays disconnected
      } finally {
        setLoading(false);
      }
    };
    checkConnection();
  }, []);

  const syncData = settings.syncData || { contacts: true, pipelines: true, conversations: true };

  const handleSaveApiKey = async (key: string) => {
    setSavingApiKey(true);
    try {
      await upsertIntegrationConnection("gohighlevel", { api_key: key, location_id: settings.locationId || '' });
      updateSettings("gohighlevel", { ...settings, apiKey: key });
      setApiKeyConfigured("gohighlevel", true);
      toast.success("API Key saved to your account");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingApiKey(false);
    }
  };

  const handleSaveLocationId = async (id: string) => {
    setSavingLocationId(true);
    try {
      await upsertIntegrationConnection("gohighlevel", { api_key: settings.apiKey || '', location_id: id });
      updateSettings("gohighlevel", { ...settings, locationId: id });
      toast.success("Location ID saved to your account");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingLocationId(false);
    }
  };

  const handleConnect = async () => {
    try {
      await callGHL("list_contacts", { limit: 1 });
      setStatus("gohighlevel", "connected");
      setApiKeyConfigured("gohighlevel", true);
      setLastSync("gohighlevel", new Date().toISOString());
      updateSettings("gohighlevel", {
        ...settings,
        subAccounts: [{ id: "default", name: "Primary Account", syncing: false }],
      });
      setSelectedAccount("default");
      toast.success("Go High Level connected");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleDisconnect = async () => {
    setStatus("gohighlevel", "disconnected");
    setApiKeyConfigured("gohighlevel", false);
    updateSettings("gohighlevel", { subAccounts: [], syncData: {} });
    await disconnectIntegration("gohighlevel");
    toast.success("Go High Level disconnected");
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      await callGHL("list_contacts", { limit: 1 });
      setStatus("gohighlevel", "connected");
      setApiKeyConfigured("gohighlevel", true);
      setLastSync("gohighlevel", new Date().toISOString());
      toast.success("GHL connection verified");
    } catch (err) {
      setStatus("gohighlevel", "error");
      toast.error(`Test failed: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };
    const updated = { ...syncData, [key]: !syncData[key] };
    updateSettings("gohighlevel", { ...settings, syncData: updated });
  };

  const handleSync = async () => {
    setStatus("gohighlevel", "syncing");

    const actions: { key: string; action: string }[] = [];
    if (syncData.contacts) actions.push({ key: "contacts", action: "list_contacts" });
    if (syncData.pipelines) actions.push({ key: "pipelines", action: "list_pipelines" });
    if (syncData.conversations) actions.push({ key: "conversations", action: "list_conversations" });

    try {
      const results = await Promise.allSettled(
        actions.map((a) => callGHL(a.action, { limit: 1 }))
      );
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length === actions.length && actions.length > 0) {
        throw new Error("All syncs failed");
      }
      setStatus("gohighlevel", "connected");
      setLastSync("gohighlevel", new Date().toISOString());
      toast.success(`GHL synced: ${actions.length - failed.length}/${actions.length} data types`);
    } catch {
      setStatus("gohighlevel", "error");
      toast.error("GHL sync failed");
    }
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
      {/* API Credentials */}
      <ApiKeyInput
        label="GHL API Key"
        placeholder="Enter your Go High Level API key…"
        configured={!!settings.apiKey || integration.status === "connected"}
        onSave={handleSaveApiKey}
        saving={savingApiKey}
        maskedHint={settings.apiKey ? "••••" + settings.apiKey.slice(-4) : integration.status === "connected" ? "•••••••• (server)" : undefined}
      />
      <ApiKeyInput
        label="GHL Location ID"
        placeholder="Enter your Location ID…"
        configured={!!settings.locationId || integration.status === "connected"}
        onSave={handleSaveLocationId}
        saving={savingLocationId}
        maskedHint={settings.locationId ? "••••" + settings.locationId.slice(-4) : integration.status === "connected" ? "•••••••• (server)" : undefined}
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
