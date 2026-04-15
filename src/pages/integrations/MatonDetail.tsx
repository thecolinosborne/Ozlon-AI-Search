import { useEffect, useState } from "react";
import { Zap, ExternalLink } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { SyncControl } from "@/components/integrations/SyncControl";
import { ApiKeyInput } from "@/components/integrations/ApiKeyInput";
import { IntegrationStatusBadge } from "@/components/integrations/IntegrationStatusBadge";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { fetchMatonConnections, formatAppName, type MatonConnection } from "@/services/matonService";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MatonDetail = () => {
  const { getIntegration, setStatus, setSyncDirection, setLastSync, setApiKeyConfigured, updateSettings } = useIntegrationsStore();
  const integration = getIntegration("maton");
  const settings = integration.settings as { apiKey?: string };
  const [connections, setConnections] = useState<MatonConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(false);

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    setLoading(true);
    try {
      const data = await fetchMatonConnections();
      setConnections(data);
      if (data.length > 0) {
        setStatus("maton", "connected");
        setApiKeyConfigured("maton", true);
        setLastSync("maton", new Date().toISOString());
      }
    } catch (error) {
      console.error("Failed to fetch Maton connections:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveApiKey = (key: string) => {
    setSavingKey(true);
    updateSettings("maton", { ...settings, apiKey: key });
    setApiKeyConfigured("maton", true);
    toast.success("API Key saved");
    setSavingKey(false);
  };

  const handleSync = async () => {
    setStatus("maton", "syncing");
    try {
      await loadConnections();
      setLastSync("maton", new Date().toISOString());
      setStatus("maton", "connected");
      toast.success("Maton services synced");
    } catch {
      setStatus("maton", "error");
      toast.error("Sync failed");
    }
  };

  const handleDisconnect = () => {
    setStatus("maton", "disconnected");
    setApiKeyConfigured("maton", false);
    setConnections([]);
    toast.success("Maton disconnected");
  };

  return (
    <IntegrationDetailLayout
      name="Maton AI"
      description="API gateway for 100+ services"
      icon={Zap}
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
          <a
            href="https://app.maton.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Connect via Maton <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )
      }
    >
      {/* API Key Input */}
      <ApiKeyInput
        label="Maton API Key"
        placeholder="Enter your Maton API key…"
        configured={!!settings.apiKey}
        onSave={handleSaveApiKey}
        saving={savingKey}
      />

      <SyncControl
        direction={integration.syncDirection}
        onDirectionChange={(d) => setSyncDirection("maton", d)}
        lastSync={integration.lastSync}
        onSync={handleSync}
        syncing={integration.status === "syncing"}
      />

      {/* Connected Services */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Connected Services</h3>
          {!loading && connections.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {connections.filter(c => c.status.toUpperCase() === "ACTIVE").length} active / {connections.length} total
            </span>
          )}
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" />
          </div>
        ) : connections.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No services connected yet. Connect via Maton to get started.
          </p>
        ) : (
          <div className="space-y-2">
            {[...connections]
              .sort((a, b) => {
                const order = (s: string) => s.toUpperCase() === "ACTIVE" ? 0 : s.toUpperCase() === "PENDING" ? 1 : 2;
                return order(a.status) - order(b.status);
              })
              .map((conn) => {
                const upper = conn.status.toUpperCase();
                const badgeStatus = upper === "ACTIVE" ? "connected" : upper === "PENDING" ? "disconnected" : "error";
                const email = conn.metadata && (conn.metadata as Record<string, string>).email;
                const displayName = conn.metadata && (conn.metadata as Record<string, string>).name;
                return (
                  <div
                    key={conn.connection_id}
                    className="flex items-center justify-between p-3.5 rounded-xl border border-border/40 bg-card/60"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{formatAppName(conn.app)}</p>
                      {email ? (
                        <p className="text-[11px] text-muted-foreground truncate">{displayName ? `${displayName} · ` : ''}{email}</p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground capitalize">{conn.method}</p>
                      )}
                    </div>
                    <IntegrationStatusBadge status={badgeStatus} />
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </IntegrationDetailLayout>
  );
};

export default MatonDetail;
