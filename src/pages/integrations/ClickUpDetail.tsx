import { useState, useEffect } from "react";
import { CheckSquare, ListTodo, Plus, Webhook, Zap, RefreshCw, ChevronRight } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";

import { ApiKeyInput } from "@/components/integrations/ApiKeyInput";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/clickup`;
const HEADERS = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
};

async function callClickUp(action: string, params?: Record<string, unknown>) {
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ action, params }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

interface ClickUpConfig {
  auto_reply_enabled: boolean;
  reply_trigger_mode: string;
  ai_reply_mode: string;
  allow_subtask_creation: boolean;
  allow_task_updates: boolean;
  webhook_status: string;
  last_webhook_event_at: string | null;
  last_successful_ai_reply_at: string | null;
}

const defaultConfig: ClickUpConfig = {
  auto_reply_enabled: true,
  reply_trigger_mode: "mention_only",
  ai_reply_mode: "standard",
  allow_subtask_creation: false,
  allow_task_updates: false,
  webhook_status: "not_registered",
  last_webhook_event_at: null,
  last_successful_ai_reply_at: null,
};

const triggerModes = [
  { value: "mention_only", label: "Mention Only" },
  { value: "always", label: "Always" },
  { value: "disabled", label: "Disabled" },
];

const replyModes = [
  { value: "brief", label: "Brief" },
  { value: "standard", label: "Standard" },
  { value: "detailed", label: "Detailed" },
];

const ClickUpDetail = () => {
  const { getIntegration, setStatus, setLastSync, updateSettings, setApiKeyConfigured } =
    useIntegrationsStore();
  const integration = getIntegration("clickup");
  const storedSettings = integration.settings as { team_id?: string; list_id?: string; apiToken?: string };
  const [config, setConfig] = useState<ClickUpConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [teamIdInput, setTeamIdInput] = useState<string>(storedSettings.team_id || "");
  const [defaultListIdInput, setDefaultListIdInput] = useState<string>(storedSettings.list_id || "");

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

  const getAuthParams = (): Record<string, unknown> => ({
    teamId: teamIdInput || undefined,
    defaultListId: defaultListIdInput || undefined,
    apiToken: storedSettings.apiToken || undefined,
  });

  // Check connection on mount
  useEffect(() => {
    const check = async () => {
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
          setTeamIdInput(result.team_id || "");
          setDefaultListIdInput(result.list_id || "");
        }
        // Load config
        const cfg = await callClickUp("get_config", { teamId: result?.team_id || teamIdInput || undefined, apiToken: storedSettings.apiToken || undefined });
        setConfig({ ...defaultConfig, ...cfg });
      } catch {
        // stays disconnected
      } finally {
        setLoading(false);
      }
    };
    check();
  }, []);

  const handleSaveApiToken = (token: string) => {
    setSavingKey(true);
    updateSettings("clickup", { ...storedSettings, apiToken: token });
    setApiKeyConfigured("clickup", true);
    toast.success("API Token saved");
    setSavingKey(false);
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
        setTeamIdInput(result.team_id || "");
        setDefaultListIdInput(result.list_id || "");
        toast.success("ClickUp connected");
      } else {
        toast.error("Connection failed — check your API token");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = () => {
    setStatus("clickup", "disconnected");
    setApiKeyConfigured("clickup", false);
    updateSettings("clickup", {});
    toast.success("ClickUp disconnected");
  };

  const handleSync = async () => {
    setStatus("clickup", "syncing");
    try {
      const tasks = await callClickUp("list_tasks", getAuthParams());
      setTaskCount(tasks.tasks?.length || 0);
      setStatus("clickup", "connected");
      setLastSync("clickup", new Date().toISOString());
      toast.success(`Synced ${tasks.tasks?.length || 0} tasks`);
    } catch {
      setStatus("clickup", "error");
      toast.error("Sync failed");
    }
  };

  const handleFetchTasks = async () => {
    try {
      const data = await callClickUp("list_tasks", getAuthParams());
      setTaskCount(data.tasks?.length || 0);
      toast.success(`Found ${data.tasks?.length || 0} tasks`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleCreateTestTask = async () => {
    try {
      const authParams = getAuthParams();
      await callClickUp("create_task", {
        ...authParams,
        listId: defaultListIdInput || authParams.defaultListId,
        name: `[Test] AI PM Test — ${new Date().toLocaleTimeString()}`,
        description: "This is a test task created by the AI Project Manager integration.",
      });
      toast.success("Test task created");
    } catch (err) {
      toast.error((err as Error).message);
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
      setConfig((c) => ({ ...c }));
      toast.success("Default list updated");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleRegisterWebhook = async () => {
    try {
      const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/clickup`;
      await callClickUp("register_webhook", { ...getAuthParams(), endpoint: webhookUrl });
      setConfig((c) => ({ ...c, webhook_status: "registered" }));
      toast.success("Webhook registered");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const updateConfigField = async (field: string, value: unknown) => {
    try {
      const updated = await callClickUp("update_config", { ...getAuthParams(), [field]: value });
      setConfig((c) => ({ ...c, ...updated }));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const isConnected = integration.status === "connected";

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

      <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
        <h3 className="text-sm font-medium text-foreground">Workspace Inputs</h3>
        <p className="text-xs text-muted-foreground">
          Team and default list IDs for workspace routing.
        </p>
        <input
          type="text"
          value={teamIdInput}
          onChange={(e) => setTeamIdInput(e.target.value)}
          placeholder="Team ID (optional)"
          className={cn(
            "w-full px-3 py-2 rounded-xl border border-border bg-background text-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground"
          )}
        />
        <input
          type="text"
          value={defaultListIdInput}
          onChange={(e) => setDefaultListIdInput(e.target.value)}
          placeholder="Default List ID (optional)"
          className={cn(
            "w-full px-3 py-2 rounded-xl border border-border bg-background text-sm",
            "focus:outline-none focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground"
          )}
        />
      </div>

      {isConnected && (
        <>
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

          {/* Webhook Status */}
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
                <Webhook className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
                Webhook
              </h3>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-xs font-medium",
                  config.webhook_status === "registered"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground"
                )}
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    config.webhook_status === "registered"
                      ? "bg-emerald-500"
                      : "bg-muted-foreground/40"
                  )}
                />
                {config.webhook_status === "registered" ? "Registered" : "Not Registered"}
              </span>
            </div>
            {config.webhook_status !== "registered" && (
              <button
                onClick={handleRegisterWebhook}
                className="w-full py-2 rounded-xl text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                Register Webhook
              </button>
            )}
            {config.last_webhook_event_at && (
              <p className="text-[11px] text-muted-foreground/60">
                Last event: {new Date(config.last_webhook_event_at).toLocaleString()}
              </p>
            )}
          </div>

          {/* Reply Settings */}
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-4">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Zap className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
              AI Reply Settings
            </h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">Auto-Reply</span>
                <button
                  onClick={() => updateConfigField("auto_reply_enabled", !config.auto_reply_enabled)}
                  className={cn(
                    "w-10 h-5.5 rounded-full p-0.5 transition-colors",
                    config.auto_reply_enabled ? "bg-primary" : "bg-muted"
                  )}
                >
                  <div
                    className={cn(
                      "w-4.5 h-4.5 rounded-full bg-white transition-transform shadow-sm",
                      config.auto_reply_enabled ? "translate-x-[18px]" : "translate-x-0"
                    )}
                    style={{ width: 18, height: 18 }}
                  />
                </button>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Trigger Mode</label>
                <Select value={config.reply_trigger_mode} onValueChange={(v) => updateConfigField("reply_trigger_mode", v)}>
                  <SelectTrigger className="h-9 text-xs rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {triggerModes.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Reply Detail</label>
                <Select value={config.ai_reply_mode} onValueChange={(v) => updateConfigField("ai_reply_mode", v)}>
                  <SelectTrigger className="h-9 text-xs rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {replyModes.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">Allow Subtask Creation</span>
                <button
                  onClick={() => updateConfigField("allow_subtask_creation", !config.allow_subtask_creation)}
                  className={cn(
                    "w-10 h-5.5 rounded-full p-0.5 transition-colors",
                    config.allow_subtask_creation ? "bg-primary" : "bg-muted"
                  )}
                >
                  <div
                    className={cn(
                      "w-4.5 h-4.5 rounded-full bg-white transition-transform shadow-sm",
                      config.allow_subtask_creation ? "translate-x-[18px]" : "translate-x-0"
                    )}
                    style={{ width: 18, height: 18 }}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">Allow Task Updates</span>
                <button
                  onClick={() => updateConfigField("allow_task_updates", !config.allow_task_updates)}
                  className={cn(
                    "w-10 h-5.5 rounded-full p-0.5 transition-colors",
                    config.allow_task_updates ? "bg-primary" : "bg-muted"
                  )}
                >
                  <div
                    className={cn(
                      "w-4.5 h-4.5 rounded-full bg-white transition-transform shadow-sm",
                      config.allow_task_updates ? "translate-x-[18px]" : "translate-x-0"
                    )}
                    style={{ width: 18, height: 18 }}
                  />
                </button>
              </div>
            </div>

            {config.last_successful_ai_reply_at && (
              <p className="text-[11px] text-muted-foreground/60">
                Last AI reply: {new Date(config.last_successful_ai_reply_at).toLocaleString()}
              </p>
            )}
          </div>

          {/* Quick Actions */}
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <h3 className="text-sm font-medium text-foreground">Quick Actions</h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={handleFetchTasks} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-border hover:bg-muted/60 transition-colors text-foreground">
                <RefreshCw className="w-3.5 h-3.5" /> Fetch Tasks
              </button>
              <button onClick={handleCreateTestTask} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-border hover:bg-muted/60 transition-colors text-foreground">
                <Plus className="w-3.5 h-3.5" /> Create Test Task
              </button>
            </div>
            {taskCount !== null && (
              <p className="text-[11px] text-muted-foreground">
                {taskCount} task{taskCount !== 1 ? "s" : ""} in default list
              </p>
            )}
          </div>
        </>
      )}
    </IntegrationDetailLayout>
  );
};

export default ClickUpDetail;
