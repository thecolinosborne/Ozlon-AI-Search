import { useState, useEffect } from "react";
import { Sparkles, Settings2, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { SyncControl } from "@/components/integrations/SyncControl";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { invokeFunction } from "@/services/backendFunctions";

import { toast } from "sonner";

const HiggsFieldDetail = () => {
  const { getIntegration, setStatus, setSyncDirection, setLastSync, setApiKeyConfigured } = useIntegrationsStore();
  const integration = getIntegration("higgsfield");

  const [autoDetecting, setAutoDetecting] = useState(true);
  const [testing, setTesting] = useState(false);

  // Auto-detect backend credentials on mount
  useEffect(() => {
    let cancelled = false;
    const detectKey = async () => {
      setAutoDetecting(true);
      try {
        const data = await invokeFunction<{ success?: boolean }>("higgsfield", { action: "test_connection" });
        
        if (cancelled) return;
        if (data?.success) {
          setStatus("higgsfield", "connected");
          setApiKeyConfigured("higgsfield", true);
          setLastSync("higgsfield", new Date().toISOString());
          if (getIntegration("higgsfield").syncDirection !== "two-way") {
            setSyncDirection("higgsfield", "two-way");
          }
        } else {
          setStatus("higgsfield", "disconnected");
          setApiKeyConfigured("higgsfield", false);
        }
      } catch (e) {
        
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
  }, []);

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const data = await invokeFunction<{ success?: boolean; error?: string }>("higgsfield", { action: "test_connection" });
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
      {autoDetecting && (
        <div className="p-4 rounded-2xl border border-border/40 bg-card/60 flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Detecting backend API key…</p>
        </div>
      )}

      {!autoDetecting && integration.status === "disconnected" && (
        <div className="p-4 rounded-2xl border border-destructive/30 bg-destructive/5 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-destructive" />
          <p className="text-sm text-destructive">
            Backend API key not configured. Please add it as a backend secret.
          </p>
        </div>
      )}

      {integration.status === "connected" && (
        <>
          {/* Connection & Test */}
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

          {/* Two-way Sync Control */}
          <SyncControl
            direction={integration.syncDirection}
            onDirectionChange={(d) => setSyncDirection("higgsfield", d)}
            lastSync={integration.lastSync}
          />

          {/* Model & Configuration */}
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

          {/* Capabilities */}
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
