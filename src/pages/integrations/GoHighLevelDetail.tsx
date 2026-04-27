import { useState, useEffect } from "react";
import { Globe, Users, GitBranch, MessageSquare, Plus, Trash2, Star, X } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { ApiKeyInput } from "@/components/integrations/ApiKeyInput";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { upsertIntegrationConnection, disconnectIntegration } from "@/services/integrationConnectionService";
import { supabase } from "@/integrations/supabase/client";

interface SubAccount {
  id: string;        // GHL location_id
  name: string;
  api_key?: string;  // optional per-sub-account key (falls back to top-level)
}

interface GHLSettings {
  apiKey?: string;
  locationId?: string;       // active/default sub-account id
  subAccounts?: SubAccount[];
  syncData?: Record<string, boolean>;
  [key: string]: unknown;
}

const dataSyncOptions = [
  { key: "contacts", label: "Contacts", icon: Users },
  { key: "pipelines", label: "Pipelines", icon: GitBranch },
  { key: "conversations", label: "Conversations", icon: MessageSquare },
];

const GoHighLevelDetail = () => {
  const { getIntegration, setStatus, setLastSync, updateSettings, setApiKeyConfigured } = useIntegrationsStore();
  const integration = getIntegration("gohighlevel");
  const settings = integration.settings as GHLSettings;
  const [loading, setLoading] = useState(true);
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [savingLocationId, setSavingLocationId] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSub, setNewSub] = useState<SubAccount>({ id: "", name: "", api_key: "" });
  const [aiDefaultId, setAiDefaultId] = useState<string | null>(null);
  const [savingDefault, setSavingDefault] = useState<string | null>(null);

  const subAccounts: SubAccount[] = settings.subAccounts || [];
  const activeId = settings.locationId || subAccounts[0]?.id || "";

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
        if (!settings.syncData) {
          updateSettings("gohighlevel", {
            ...settings,
            syncData: { contacts: true, pipelines: true, conversations: true },
          });
        }
      } catch {
        // silently fail — stays disconnected
      } finally {
        setLoading(false);
      }
    };
    checkConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the user's permanent AI default GHL sub-account.
  useEffect(() => {
    const loadDefault = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("default_ghl_location_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data?.default_ghl_location_id) setAiDefaultId(data.default_ghl_location_id);
    };
    loadDefault();
  }, []);

  const handleSetAiDefault = async (id: string) => {
    setSavingDefault(id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("profiles")
        .update({ default_ghl_location_id: id })
        .eq("user_id", user.id);
      if (error) throw error;
      setAiDefaultId(id);
      const sub = subAccounts.find((s) => s.id === id);
      toast.success(`"${sub?.name || id}" is now your AI default`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingDefault(null);
    }
  };

  const syncData = settings.syncData || { contacts: true, pipelines: true, conversations: true };

  const persistMetadata = async (next: GHLSettings) => {
    const metadata: Record<string, unknown> = {
      api_key: next.apiKey || "",
      location_id: next.locationId || "",
      sub_accounts: next.subAccounts || [],
    };
    await upsertIntegrationConnection("gohighlevel", metadata);
  };

  const handleSaveApiKey = async (key: string) => {
    setSavingApiKey(true);
    try {
      const next: GHLSettings = { ...settings, apiKey: key };
      await persistMetadata(next);
      updateSettings("gohighlevel", next as unknown as Record<string, unknown>);
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
      // Top-level location_id = active default. Also seed it as a sub-account if not present.
      const subs = settings.subAccounts || [];
      const exists = subs.some((s) => s.id === id);
      const nextSubs = exists ? subs : [...subs, { id, name: "Primary" }];
      const next: GHLSettings = { ...settings, locationId: id, subAccounts: nextSubs };
      await persistMetadata(next);
      updateSettings("gohighlevel", next as unknown as Record<string, unknown>);
      toast.success("Location ID saved to your account");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingLocationId(false);
    }
  };

  const handleAddSubAccount = async () => {
    const id = newSub.id.trim();
    const name = newSub.name.trim();
    if (!id || !name) {
      toast.error("Name and Location ID are required");
      return;
    }
    if (subAccounts.some((s) => s.id === id)) {
      toast.error("A sub-account with that Location ID already exists");
      return;
    }
    const sub: SubAccount = { id, name };
    if (newSub.api_key && newSub.api_key.trim()) sub.api_key = newSub.api_key.trim();
    const nextSubs = [...subAccounts, sub];
    const next: GHLSettings = {
      ...settings,
      subAccounts: nextSubs,
      // First sub-account becomes the default if none set
      locationId: settings.locationId || sub.id,
    };
    try {
      await persistMetadata(next);
      updateSettings("gohighlevel", next as unknown as Record<string, unknown>);
      setShowAddModal(false);
      setNewSub({ id: "", name: "", api_key: "" });
      toast.success(`Added sub-account "${name}"`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleRemoveSubAccount = async (id: string) => {
    const nextSubs = subAccounts.filter((s) => s.id !== id);
    const nextActive = settings.locationId === id ? (nextSubs[0]?.id || "") : settings.locationId;
    const next: GHLSettings = { ...settings, subAccounts: nextSubs, locationId: nextActive };
    try {
      await persistMetadata(next);
      updateSettings("gohighlevel", next as unknown as Record<string, unknown>);
      toast.success("Sub-account removed");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleSetActive = async (id: string) => {
    const next: GHLSettings = { ...settings, locationId: id };
    try {
      await persistMetadata(next);
      updateSettings("gohighlevel", next as unknown as Record<string, unknown>);
      toast.success("Default sub-account updated");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleConnect = async () => {
    try {
      await callGHL("list_contacts", { limit: 1 });
      setStatus("gohighlevel", "connected");
      setApiKeyConfigured("gohighlevel", true);
      setLastSync("gohighlevel", new Date().toISOString());
      toast.success("Go High Level connected");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleDisconnect = async () => {
    setStatus("gohighlevel", "disconnected");
    setApiKeyConfigured("gohighlevel", false);
    updateSettings("gohighlevel", { subAccounts: [], syncData: {}, apiKey: "", locationId: "" });
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

  const toggleSyncData = (key: string) => {
    const updated = { ...syncData, [key]: !syncData[key] };
    updateSettings("gohighlevel", { ...settings, syncData: updated });
  };

  return (
    <IntegrationDetailLayout
      name="Go High Level"
      description="CRM platform with contacts, pipelines, and marketing"
      icon={Globe}
      status={integration.status}
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={handleTestConnection}
            disabled={testing}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
          >
            {testing ? "Testing…" : "Test Connection"}
          </button>
          {integration.status === "connected" ? (
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
          )}
        </div>
      }
    >
      {/* API Credentials */}
      <ApiKeyInput
        label="GHL API Key (default)"
        placeholder="Enter your Go High Level API key…"
        configured={!!settings.apiKey || integration.status === "connected"}
        onSave={handleSaveApiKey}
        saving={savingApiKey}
        maskedHint={settings.apiKey ? "••••" + settings.apiKey.slice(-4) : integration.status === "connected" ? "•••••••• (server)" : undefined}
      />
      <ApiKeyInput
        label="Default Location ID"
        placeholder="Enter your primary Location ID…"
        configured={!!settings.locationId || integration.status === "connected"}
        onSave={handleSaveLocationId}
        saving={savingLocationId}
        maskedHint={settings.locationId ? "••••" + settings.locationId.slice(-4) : integration.status === "connected" ? "•••••••• (server)" : undefined}
      />

      {/* Sub-Accounts */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-foreground">Sub-Accounts</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add multiple GHL locations. The AI can switch between them by name.
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2} />
            Add
          </button>
        </div>

        {subAccounts.length === 0 ? (
          <div className="p-4 rounded-xl border border-dashed border-border/40 bg-card/40 text-xs text-muted-foreground text-center">
            No sub-accounts configured yet. Save a default Location ID above or click Add.
          </div>
        ) : (
          <div className="space-y-2">
            {subAccounts.map((acct) => (
              <div
                key={acct.id}
                className={cn(
                  "flex items-center justify-between p-3.5 rounded-xl border transition-all",
                  acct.id === activeId
                    ? "border-primary/30 bg-primary/5"
                    : "border-border/40 bg-card/60"
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground truncate">{acct.name}</span>
                    {acct.id === activeId && (
                      <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                        Default
                      </span>
                    )}
                    {acct.id === aiDefaultId && (
                      <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                        AI Default
                      </span>
                    )}
                    {acct.api_key && (
                      <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                        own key
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">
                    {acct.id}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {acct.id !== aiDefaultId && (
                    <button
                      onClick={() => handleSetAiDefault(acct.id)}
                      disabled={savingDefault === acct.id}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
                      title="Make this the default account the AI uses in every new chat"
                    >
                      {savingDefault === acct.id ? "Saving…" : "AI default"}
                    </button>
                  )}
                  {acct.id !== activeId && (
                    <button
                      onClick={() => handleSetActive(acct.id)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      title="Set as default"
                    >
                      <Star className="w-3.5 h-3.5" strokeWidth={1.5} />
                    </button>
                  )}
                  <button
                    onClick={() => handleRemoveSubAccount(acct.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add sub-account modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-foreground">Add Sub-Account</h3>
              <button
                onClick={() => { setShowAddModal(false); setNewSub({ id: "", name: "", api_key: "" }); }}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Friendly name</label>
                <input
                  type="text"
                  value={newSub.name}
                  onChange={(e) => setNewSub((s) => ({ ...s, name: e.target.value }))}
                  placeholder="e.g. Client B"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Location ID</label>
                <input
                  type="text"
                  value={newSub.id}
                  onChange={(e) => setNewSub((s) => ({ ...s, id: e.target.value }))}
                  placeholder="e.g. ve9EPM428h8vShlRW1KT"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  API Key <span className="text-muted-foreground/70">(optional — falls back to default)</span>
                </label>
                <input
                  type="password"
                  value={newSub.api_key || ""}
                  onChange={(e) => setNewSub((s) => ({ ...s, api_key: e.target.value }))}
                  placeholder="Leave blank to use the default key"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-border/60 bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => { setShowAddModal(false); setNewSub({ id: "", name: "", api_key: "" }); }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60"
              >
                Cancel
              </button>
              <button
                onClick={handleAddSubAccount}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Add Sub-Account
              </button>
            </div>
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
