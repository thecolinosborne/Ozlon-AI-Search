import { useState, useEffect } from "react";
import { Sparkles, Settings2, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { ApiKeyInput } from "@/components/integrations/ApiKeyInput";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { toast } from "sonner";
import { upsertIntegrationConnection, disconnectIntegration } from "@/services/integrationConnectionService";

const HiggsFieldDetail = () => {
  const { getIntegration, setStatus, setLastSync, setApiKeyConfigured, updateSettings } = useIntegrationsStore();
  const integration = getIntegration("higgsfield");
  const settings = integration.settings as { apiKey?: string; appId?: string };

  const [autoDetecting, setAutoDetecting] = useState(true);
  const [testing, setTesting] = useState(false);
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [savingAppId, setSavingAppId] = useState(false);

  const callHiggsfield = async (action: string, params: Record<string, unknown> = {}) => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/higgsfield`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ action, ...params, apiKey: settings.apiKey || undefined, appId: settings.appId || undefined }),
    });
    return res.json();
  };

  // Auto-detect on mount
  useEffect(() => {
    let cancelled = false;
    const detectKey = async () => {
      setAutoDetecting(true);
      try {
        const data = await callHiggsfield("test_connection");
        if (cancelled) return;
        if (data?.success) {
          setStatus("higgsfield", "connected");
          setApiKeyConfigured("higgsfield", true);
          setLastSync("higgsfield", new Date().toISOString());
        } else {
          setStatus("higgsfield", "disconnected");
          setApiKeyConfigured("higgsfield", false);
        }
      } catch {
        if (!cancelled) {
          setStatus("higgsfield", "disconnected");
          setApiKeyConfigured("higgsfield", false);
        }
      } finally {
        if (!cancelled) setAutoDetecting(false);
      }
    };
    detectKey();
    return () => { cancelled = true; };
  }, [settings.apiKey, settings.appId]);

  const handleSaveApiKey = async (key: string) => {
    setSavingApiKey(true);
    try {
      await upsertIntegrationConnection("higgsfield", { api_key: key, app_id: settings.appId || '' });
      updateSettings("higgsfield", { ...settings, apiKey: key });
      setApiKeyConfigured("higgsfield", true);
      toast.success("API Key saved to your account");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingApiKey(false);
    }
  };

  const handleSaveAppId = async (id: string) => {
    setSavingAppId(true);
    try {
      await upsertIntegrationConnection("higgsfield", { app_id: id, api_key: settings.apiKey || '' });
      updateSettings("higgsfield", { ...settings, appId: id });
      toast.success("App ID saved to your account");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingAppId(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const data = await callHiggsfield("test_connection");
      if (data?.success) {
        toast.success("Higgsfield AI connection verified");
        setStatus("higgsfield", "connected");
        setApiKeyConfigured("higgsfield", true);
        setLastSync("higgsfield", new Date().toISOString());
      } else {
        toast.error(data?.error || "Connection failed");
      }
    } catch (e: unknown) {
      toast.error(`Connection failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    setStatus("higgsfield", "disconnected");
    setApiKeyConfigured("higgsfield", false);
    await disconnectIntegration("higgsfield");
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
      {/* API Credentials */}
      <ApiKeyInput
        label="Higgsfield API Key"
        placeholder="Enter your Higgsfield API key…"
        configured={!!settings.apiKey || integration.status === "connected"}
        onSave={handleSaveApiKey}
        saving={savingApiKey}
        maskedHint={settings.apiKey ? "••••" + settings.apiKey.slice(-4) : integration.status === "connected" ? "•••••••• (server)" : undefined}
      />
      <ApiKeyInput
        label="Higgsfield App ID"
        placeholder="Enter your App ID…"
        configured={!!settings.appId || integration.status === "connected"}
        onSave={handleSaveAppId}
        saving={savingAppId}
        maskedHint={settings.appId ? "••••" + settings.appId.slice(-4) : integration.status === "connected" ? "•••••••• (server)" : undefined}
      />

      {autoDetecting && (
        <div className="p-4 rounded-2xl border border-border/40 bg-card/60 flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Detecting connection…</p>
        </div>
      )}

      {!autoDetecting && integration.status === "disconnected" && !settings.apiKey && (
        <div className="p-4 rounded-2xl border border-destructive/30 bg-destructive/5 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-destructive" />
          <p className="text-sm text-destructive">Enter your credentials above to connect.</p>
        </div>
      )}

      {integration.status === "connected" && (
        <>
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <h3 className="text-sm font-medium text-foreground">Connection</h3>
            <div className="flex gap-2">
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <RefreshCw className="w-4 h-4 inline mr-1" />}
                Test Connection
              </button>
            </div>
          </div>

          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <h3 className="text-sm font-medium text-foreground">Models</h3>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40">
              <Settings2 className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
              <div>
                <p className="text-sm font-medium text-foreground">higgsfield-ai/soul/standard</p>
                <p className="text-[11px] text-muted-foreground">Text-to-image generation</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40">
              <Settings2 className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
              <div>
                <p className="text-sm font-medium text-foreground">higgsfield-ai/dop/standard</p>
                <p className="text-[11px] text-muted-foreground">Image-to-video generation</p>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
            <h3 className="text-sm font-medium text-foreground">Capabilities</h3>
            <div className="text-[12px] text-muted-foreground space-y-1.5">
              <p>Higgsfield serves as the visual execution engine for generating AI-powered video and image content via an async queue API.</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Text-to-image generation (Soul Standard)</li>
                <li>Image-to-video generation (DoP Standard)</li>
                <li>Multiple aspect ratios (16:9, 9:16, 1:1, 4:3)</li>
                <li>Multiple resolutions (720p+)</li>
                <li>Async job queue with status polling</li>
                <li>Request cancellation support</li>
              </ul>
            </div>
          </div>
        </>
      )}
    </IntegrationDetailLayout>
  );
};

export default HiggsFieldDetail;
