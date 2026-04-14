import { useState, useEffect } from "react";
import { CheckSquare, ListTodo, Plus, Webhook, Zap, RefreshCw, ChevronRight } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { SyncControl } from "@/components/integrations/SyncControl";
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
  const { getIntegration, setStatus, setSyncDirection, setLastSync, updateSettings } =
    useIntegrationsStore();
  const integration = getIntegration("clickup");
  const [config, setConfig] = useState<ClickUpConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [testing, setTesting] = useState(false);

  // Check connection on mount
  useEffect(() => {
    const check = async () => {
      try {
        const result = await callClickUp("test_connection");
        if (result.connected) {
          setStatus("clickup", "connected");
          setLastSync("clickup", new Date().toISOString());
          updateSettings("clickup", {
            team_id: result.team_id,
            list_id: result.list_id,
          });
        }
        // Load config
        const cfg = await callClickUp("get_config");
        setConfig({ ...defaultConfig, ...cfg });
      } catch {
        // stays disconnected
      } finally {
        setLoading(false);
      }
    };
    check();
  }, []);

  const handleConnect = async () => {
    setTesting(true);
    try {
      const result = await callClickUp("test_connection");
      if (result.connected) {
        setStatus("clickup", "connected");
        setLastSync("clickup", new Date().toISOString());
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
    updateSettings("clickup", {});
    toast.success("ClickUp disconnected");
  };

  const handleSync = async () => {
    setStatus("clickup", "syncing");
    try {
      const tasks = await callClickUp("list_tasks");
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
      const data = await callClickUp("list_tasks");
      setTaskCount(data.tasks?.length || 0);
      toast.success(`Found ${data.tasks?.length || 0} tasks`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleCreateTestTask = async () => {
    try {
      await callClickUp("create_task", {
        name: `[Test] AI PM Test — ${new Date().toLocaleTimeString()}`,
        description: "This is a test task created by the AI Project Manager integration.",
      });
      toast.success("Test task created");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleRegisterWebhook = async () => {
    try {
      const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/clickup`;
      await callClickUp("register_webhook", { endpoint: webhookUrl });
      setConfig((c) => ({ ...c, webhook_status: "registered" }));
      toast.success("Webhook registered");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const updateConfigField = async (field: string, value: unknown) => {
    try {
      const updated = await callClickUp("update_config", { [field]: value });
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
      <SyncControl
        direction={integration.syncDirection}
        onDirectionChange={(d) => setSyncDirection("clickup", d)}
        lastSync={integration.lastSync}
        onSync={handleSync}
        syncing={integration.status === "syncing"}
      />

      {isConnected && (
        <>
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

            {/* Auto-reply toggle */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">Auto-reply enabled</span>
              <button
                onClick={() => updateConfigField("auto_reply_enabled", !config.auto_reply_enabled)}
                className={cn(
                  "w-10 h-5.5 rounded-full p-0.5 transition-colors",
                  config.auto_reply_enabled ? "bg-primary" : "bg-muted"
                )}
              >
                <div
                  className={cn(
                    "rounded-full bg-white transition-transform shadow-sm",
                    config.auto_reply_enabled ? "translate-x-[18px]" : "translate-x-0"
                  )}
                  style={{ width: 18, height: 18 }}
                />
              </button>
            </div>

            {/* Trigger mode */}
            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">Trigger Mode</span>
              <div className="flex gap-2">
                {triggerModes.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => updateConfigField("reply_trigger_mode", m.value)}
                    className={cn(
                      "flex-1 py-2 rounded-xl text-xs font-medium transition-all",
                      config.reply_trigger_mode === m.value
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-muted/60 text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Reply mode */}
            <div className="space-y-2">
              <span className="text-xs text-muted-foreground">Reply Style</span>
              <div className="flex gap-2">
                {replyModes.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => updateConfigField("ai_reply_mode", m.value)}
                    className={cn(
                      "flex-1 py-2 rounded-xl text-xs font-medium transition-all",
                      config.ai_reply_mode === m.value
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-muted/60 text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Permissions */}
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <h3 className="text-sm font-medium text-foreground">Permissions</h3>
            {[
              { key: "allow_subtask_creation", label: "Allow subtask creation" },
              { key: "allow_task_updates", label: "Allow task updates" },
            ].map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-sm text-foreground">{label}</span>
                <button
                  onClick={() =>
                    updateConfigField(key, !config[key as keyof ClickUpConfig])
                  }
                  className={cn(
                    "w-10 h-5.5 rounded-full p-0.5 transition-colors",
                    config[key as keyof ClickUpConfig] ? "bg-primary" : "bg-muted"
                  )}
                >
                  <div
                    className={cn(
                      "rounded-full bg-white transition-transform shadow-sm",
                      config[key as keyof ClickUpConfig]
                        ? "translate-x-[18px]"
                        : "translate-x-0"
                    )}
                    style={{ width: 18, height: 18 }}
                  />
                </button>
              </div>
            ))}
          </div>

          {/* Test Actions */}
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <h3 className="text-sm font-medium text-foreground">Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleConnect}
                className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium bg-muted/60 text-foreground hover:bg-muted transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Test Connection
              </button>
              <button
                onClick={handleFetchTasks}
                className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium bg-muted/60 text-foreground hover:bg-muted transition-colors"
              >
                <ListTodo className="w-3.5 h-3.5" />
                Fetch Tasks
                {taskCount !== null && (
                  <span className="text-[10px] text-muted-foreground">({taskCount})</span>
                )}
              </button>
              <button
                onClick={handleCreateTestTask}
                className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-medium bg-muted/60 text-foreground hover:bg-muted transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Create Test Task
              </button>
            </div>
          </div>

          {/* Info Panel */}
          <div className="p-4 rounded-2xl border border-primary/20 bg-primary/5 space-y-2">
            <p className="text-sm font-medium text-foreground">How it works</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Mention <strong>@AI</strong> in a ClickUp task comment and the AI will
              respond directly on that task. Ask for summaries, blockers, next steps,
              subtasks, updates, and priorities.
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Triggers: <code className="text-[11px] bg-muted/60 px-1 py-0.5 rounded">@AI</code>{" "}
              <code className="text-[11px] bg-muted/60 px-1 py-0.5 rounded">@PM</code>{" "}
              <code className="text-[11px] bg-muted/60 px-1 py-0.5 rounded">@Wisdom</code>
            </p>
            {config.last_successful_ai_reply_at && (
              <p className="text-[11px] text-muted-foreground/60">
                Last AI reply: {new Date(config.last_successful_ai_reply_at).toLocaleString()}
              </p>
            )}
          </div>
        </>
      )}
    </IntegrationDetailLayout>
  );
};

export default ClickUpDetail;
