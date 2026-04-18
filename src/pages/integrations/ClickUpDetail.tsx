import { useState, useEffect, useCallback } from "react";
import { CheckSquare, ListTodo, RefreshCw, Webhook, Plus, X } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { ApiKeyInput } from "@/components/integrations/ApiKeyInput";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { upsertIntegrationConnection, disconnectIntegration } from "@/services/integrationConnectionService";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

async function callClickUp(action: string, params?: Record<string, unknown>) {
  // Use supabase.functions.invoke so the authenticated user's JWT is automatically
  // attached as the Authorization header. The clickup edge function needs this to
  // resolve the per-user vault credential.
  const { data, error } = await supabase.functions.invoke("clickup", {
    body: { action, params },
  });
  if (error) {
    // FunctionsHttpError exposes the response body via context.json()
    let serverMsg: string | null = null;
    try {
      const ctx = (error as unknown as { context?: { json?: () => Promise<{ error?: string }> } }).context;
      if (ctx?.json) {
        const parsed = await ctx.json();
        serverMsg = parsed?.error ?? null;
      }
    } catch {
      /* ignore */
    }
    throw new Error(serverMsg || error.message || "Request failed");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

const DEFAULT_TRIGGERS = ["@ai", "@pm", "@wisdom"];

const ClickUpDetail = () => {
  const { session, authLoading } = useAuth();
  const { getIntegration, setStatus, setLastSync, updateSettings, setApiKeyConfigured } =
    useIntegrationsStore();
  const integration = getIntegration("clickup");
  const storedSettings = integration.settings as { team_id?: string; list_id?: string; apiToken?: string };
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [savingKey, setSavingKey] = useState(false);

  // List picker state
  const [spaces, setSpaces] = useState<{ id: string; name: string }[]>([]);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [lists, setLists] = useState<{ id: string; name: string }[]>([]);
  const [selectedSpace, setSelectedSpace] = useState<string>("");
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [selectedList, setSelectedList] = useState<string>("");
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [loadingLists, setLoadingLists] = useState(false);

  // Webhook config state
  const [webhookStatus, setWebhookStatus] = useState<string>("not_registered");
  const [registeringWebhook, setRegisteringWebhook] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(true);
  const [replyMode, setReplyMode] = useState<string>("standard");
  const [triggers, setTriggers] = useState<string[]>(DEFAULT_TRIGGERS);
  const [newTrigger, setNewTrigger] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  // Don't send apiToken on the wire — let the edge function resolve via vault-first path.
  // storedSettings.apiToken is kept locally only for the masked-hint display.
  const getAuthParams = (): Record<string, unknown> => ({});

  const loadConnection = useCallback(async () => {
    if (authLoading) return;
    if (!session) {
      setStatus("clickup", "disconnected");
      setApiKeyConfigured("clickup", false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = await callClickUp("test_connection", getAuthParams());
      if (result.connected) {
        setStatus("clickup", "connected");
        setApiKeyConfigured("clickup", true);
        setLastSync("clickup", new Date().toISOString());
        updateSettings("clickup", {
          ...storedSettings,
          team_id: result.team_id,
          list_id: result.list_id,
        });
        try {
          const config = await callClickUp("get_config", getAuthParams());
          if (config) {
            setWebhookStatus(config.webhook_status || "not_registered");
            setAutoReplyEnabled(config.auto_reply_enabled ?? true);
            setReplyMode(config.ai_reply_mode || "standard");
            if (config.custom_triggers?.length > 0) {
              setTriggers(config.custom_triggers);
            }
          }
        } catch {
          /* best effort */
        }
      } else {
        setStatus("clickup", "disconnected");
        setApiKeyConfigured("clickup", false);
      }
    } catch {
      setStatus("clickup", "disconnected");
      setApiKeyConfigured("clickup", false);
    } finally {
      setLoading(false);
    }
  }, [authLoading, session, setApiKeyConfigured, setLastSync, setStatus, storedSettings, updateSettings]);

  // Check connection on mount
  useEffect(() => {
    void loadConnection();
  }, [loadConnection]);

  const handleSaveApiToken = async (token: string) => {
    setSavingKey(true);
    try {
      await upsertIntegrationConnection("clickup", { api_key: token });
      const result = await callClickUp("connect", getAuthParams());
      if (!result.connected) {
        setStatus("clickup", "error");
        toast.error("Connection failed — check your API token");
        return false;
      }
      updateSettings("clickup", { ...storedSettings, apiToken: token });
      setStatus("clickup", "connected");
      setApiKeyConfigured("clickup", true);
      setLastSync("clickup", new Date().toISOString());
      updateSettings("clickup", {
        ...storedSettings,
        apiToken: token,
        team_id: result.team_id,
        list_id: result.list_id,
      });
      toast.success("ClickUp connected");
      return true;
    } catch (err) {
      setStatus("clickup", "error");
      toast.error((err as Error).message);
      return false;
    } finally {
      setSavingKey(false);
    }
  };

  const handleConnect = async () => {
    setTesting(true);
    try {
      const result = await callClickUp("connect", getAuthParams());
      if (result.connected) {
        setStatus("clickup", "connected");
        setApiKeyConfigured("clickup", true);
        setLastSync("clickup", new Date().toISOString());
        updateSettings("clickup", {
          ...storedSettings,
          team_id: result.team_id,
          list_id: result.list_id,
        });
        toast.success("ClickUp connected");
      } else {
        setStatus("clickup", "error");
        toast.error("Connection failed — check your API token");
      }
    } catch (err) {
      setStatus("clickup", "error");
      toast.error((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    setStatus("clickup", "disconnected");
    setApiKeyConfigured("clickup", false);
    updateSettings("clickup", {});
    await disconnectIntegration("clickup");
    toast.success("ClickUp disconnected");
  };

  const handleSync = async () => {
    setStatus("clickup", "syncing");
    try {
      const tasks = await callClickUp("list_tasks", getAuthParams());
      setStatus("clickup", "connected");
      setLastSync("clickup", new Date().toISOString());
      toast.success(`Synced ${tasks.tasks?.length || 0} tasks`);
    } catch {
      setStatus("clickup", "error");
      toast.error("Sync failed");
    }
  };

  // ===== List Picker Handlers =====
  const fetchSpaces = async () => {
    setLoadingSpaces(true);
    try {
      const data = await callClickUp("list_spaces", getAuthParams());
      setSpaces((data.spaces || []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingSpaces(false);
    }
  };

  const handleSpaceChange = async (spaceId: string) => {
    setSelectedSpace(spaceId);
    setSelectedFolder("");
    setSelectedList("");
    setFolders([]);
    setLists([]);
    setLoadingFolders(true);
    try {
      const data = await callClickUp("list_folders", { ...getAuthParams(), spaceId });
      const f = (data.folders || []).map((f: { id: string; name: string }) => ({ id: f.id, name: f.name }));
      setFolders(f);
      const folderless = await callClickUp("list_lists", { ...getAuthParams(), spaceId });
      const fl = (folderless.lists || []).map((l: { id: string; name: string }) => ({ id: l.id, name: l.name }));
      if (fl.length > 0 && f.length === 0) {
        setLists(fl);
      } else if (fl.length > 0) {
        setFolders([{ id: "__folderless__", name: "Lists (no folder)" }, ...f]);
        setLists(fl);
        setSelectedFolder("__folderless__");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleFolderChange = async (folderId: string) => {
    setSelectedFolder(folderId);
    setSelectedList("");
    setLists([]);
    if (folderId === "__folderless__") {
      setLoadingLists(true);
      try {
        const data = await callClickUp("list_lists", { ...getAuthParams(), spaceId: selectedSpace });
        setLists((data.lists || []).map((l: { id: string; name: string }) => ({ id: l.id, name: l.name })));
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setLoadingLists(false);
      }
      return;
    }
    setLoadingLists(true);
    try {
      const data = await callClickUp("list_lists", { ...getAuthParams(), folderId });
      setLists((data.lists || []).map((l: { id: string; name: string }) => ({ id: l.id, name: l.name })));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoadingLists(false);
    }
  };

  const handleListSelect = async (listId: string) => {
    setSelectedList(listId);
    try {
      await callClickUp("update_config", { ...getAuthParams(), default_list_id: listId });
      toast.success("Default list updated");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  // ===== Webhook & Trigger Handlers =====
  const handleRegisterWebhook = async () => {
    setRegisteringWebhook(true);
    try {
      const endpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/clickup`;
      await callClickUp("register_webhook", { ...getAuthParams(), endpoint });
      setWebhookStatus("registered");
      toast.success("Webhook registered — AI will respond to mentions in ClickUp");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRegisteringWebhook(false);
    }
  };

  const saveWebhookConfig = async (overrides: Record<string, unknown>) => {
    setSavingConfig(true);
    try {
      await callClickUp("update_config", { ...getAuthParams(), ...overrides });
      toast.success("Config saved");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleToggleAutoReply = async (enabled: boolean) => {
    setAutoReplyEnabled(enabled);
    await saveWebhookConfig({ auto_reply_enabled: enabled });
  };

  const handleReplyModeChange = async (mode: string) => {
    setReplyMode(mode);
    await saveWebhookConfig({ ai_reply_mode: mode });
  };

  const handleAddTrigger = async () => {
    const t = newTrigger.trim().toLowerCase();
    if (!t || triggers.includes(t)) {
      setNewTrigger("");
      return;
    }
    const updated = [...triggers, t];
    setTriggers(updated);
    setNewTrigger("");
    await saveWebhookConfig({ custom_triggers: updated });
  };

  const handleRemoveTrigger = async (trigger: string) => {
    const updated = triggers.filter(t => t !== trigger);
    setTriggers(updated);
    await saveWebhookConfig({ custom_triggers: updated.length > 0 ? updated : [] });
  };

  const isConnected = integration.status === "connected";
  const isWebhookRegistered = webhookStatus === "registered" || webhookStatus === "active";

  if (loading || authLoading) {
    return (
      <IntegrationDetailLayout
        name="ClickUp"
        description="AI Project Manager inside ClickUp task comments"
        icon={CheckSquare}
        status={integration.status}
      >
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      </IntegrationDetailLayout>
    );
  }

  return (
    <IntegrationDetailLayout
      name="ClickUp"
      description="AI Project Manager inside ClickUp task comments"
      icon={CheckSquare}
      status={integration.status}
      actions={
        isConnected ? (
          <button
            onClick={handleDisconnect}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={testing}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {testing ? "Testing…" : "Connect"}
          </button>
        )
      }
    >
      {/* API Token Input */}
      <ApiKeyInput
        label="ClickUp API Token"
        placeholder="pk_..."
        configured={!!storedSettings.apiToken || isConnected}
        onSave={handleSaveApiToken}
        saving={savingKey}
        maskedHint={storedSettings.apiToken ? "••••" + storedSettings.apiToken.slice(-4) : isConnected ? "•••••••• (server)" : undefined}
      />

      {isConnected && (
        <>
          {/* Webhook & Triggers */}
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                <Webhook className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
                Webhook & Triggers
              </h3>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                <span className={`w-1.5 h-1.5 rounded-full ${isWebhookRegistered ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                <span className={isWebhookRegistered ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
                  {isWebhookRegistered ? "Registered" : "Not Registered"}
                </span>
              </span>
            </div>

            {!isWebhookRegistered && (
              <button
                onClick={handleRegisterWebhook}
                disabled={registeringWebhook}
                className="w-full px-4 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {registeringWebhook ? "Registering…" : "Register Webhook"}
              </button>
            )}

            {isWebhookRegistered && (
              <div className="space-y-4">
                {/* Auto-reply toggle */}
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Auto-reply to mentions</Label>
                  <Switch
                    checked={autoReplyEnabled}
                    onCheckedChange={handleToggleAutoReply}
                    disabled={savingConfig}
                  />
                </div>

                {/* Reply mode */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Reply mode</Label>
                  <Select value={replyMode} onValueChange={handleReplyModeChange}>
                    <SelectTrigger className="h-9 text-xs rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="brief">Brief</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="detailed">Detailed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Trigger words */}
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Trigger words</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {triggers.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-muted/80 text-xs font-medium text-foreground"
                      >
                        {t}
                        <button
                          onClick={() => handleRemoveTrigger(t)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={newTrigger}
                      onChange={(e) => setNewTrigger(e.target.value)}
                      placeholder="@ozlon"
                      className="h-8 text-xs rounded-xl flex-1"
                      onKeyDown={(e) => e.key === "Enter" && handleAddTrigger()}
                    />
                    <button
                      onClick={handleAddTrigger}
                      className="px-3 h-8 rounded-xl text-xs font-medium border border-border hover:bg-muted/60 transition-colors text-foreground inline-flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground/60">
                    Type any of these in a ClickUp task comment to trigger an AI response
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* List Picker */}
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                <ListTodo className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
                Default List
              </h3>
              {spaces.length === 0 && (
                <button
                  onClick={fetchSpaces}
                  disabled={loadingSpaces}
                  className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  {loadingSpaces ? "Loading…" : "Browse Workspace"}
                </button>
              )}
            </div>

            {selectedList && (
              <p className="text-xs text-muted-foreground">
                Selected: <span className="font-medium text-foreground">{lists.find(l => l.id === selectedList)?.name || selectedList}</span>
              </p>
            )}

            {spaces.length > 0 && (
              <div className="space-y-2">
                <Select value={selectedSpace} onValueChange={handleSpaceChange}>
                  <SelectTrigger className="h-9 text-xs rounded-xl">
                    <SelectValue placeholder="Select Space" />
                  </SelectTrigger>
                  <SelectContent>
                    {spaces.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {folders.length > 0 && (
                  <Select value={selectedFolder} onValueChange={handleFolderChange}>
                    <SelectTrigger className="h-9 text-xs rounded-xl">
                      <SelectValue placeholder="Select Folder" />
                    </SelectTrigger>
                    <SelectContent>
                      {folders.map((f) => (
                        <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {lists.length > 0 && (
                  <Select value={selectedList} onValueChange={handleListSelect}>
                    <SelectTrigger className="h-9 text-xs rounded-xl">
                      <SelectValue placeholder="Select List" />
                    </SelectTrigger>
                    <SelectContent>
                      {lists.map((l) => (
                        <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {(loadingFolders || loadingLists) && (
                  <p className="text-[11px] text-muted-foreground/60">Loading…</p>
                )}
              </div>
            )}
          </div>

          {/* Diagnostics */}
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <h3 className="text-sm font-medium text-foreground">Diagnostics</h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={handleSync} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-border hover:bg-muted/60 transition-colors text-foreground">
                <RefreshCw className="w-3.5 h-3.5" /> Test Connection
              </button>
            </div>
          </div>
        </>
      )}
    </IntegrationDetailLayout>
  );
};

export default ClickUpDetail;
