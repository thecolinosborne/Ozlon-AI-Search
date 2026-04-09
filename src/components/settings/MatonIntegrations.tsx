import { useState, useEffect } from "react";
import { Plug, RefreshCw, CheckCircle2, XCircle, ExternalLink, LucideIcon } from "lucide-react";
import { SettingsSection } from "./SettingsSection";
import { fetchMatonConnections, formatAppName, type MatonConnection } from "@/services/matonService";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Map known apps to simple icons (could expand)
const appIcons: Record<string, string> = {
  "google-mail": "📧",
  "google-calendar": "📅",
  "google-drive": "📁",
  "google-search-console": "🔍",
  "slack": "💬",
  "notion": "📝",
  "github": "🐙",
  "hubspot": "🟠",
  "airtable": "📊",
  "microsoft-outlook": "📨",
  "microsoft-teams": "👥",
};

export const MatonIntegrations = () => {
  const [connections, setConnections] = useState<MatonConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConnections = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMatonConnections();
      setConnections(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load";
      setError(msg);
      toast.error("Failed to load Maton integrations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConnections();
  }, []);

  const activeCount = connections.filter((c) => c.status === "ACTIVE").length;

  return (
    <SettingsSection title="Maton AI Integrations">
      {/* Summary card */}
      <div className="w-full p-4 rounded-2xl bg-card/60 border border-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Plug className="w-5 h-5 text-primary" strokeWidth={1.5} />
            </div>
            <div>
              <p className="font-medium text-foreground">Maton Gateway</p>
              <p className="text-xs text-muted-foreground">
                {loading
                  ? "Loading connections..."
                  : error
                  ? "Connection error"
                  : `${activeCount} active connection${activeCount !== 1 ? "s" : ""}`}
              </p>
            </div>
          </div>
          <button
            onClick={loadConnections}
            disabled={loading}
            className="p-2 hover:bg-muted rounded-full transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={cn("w-4 h-4 text-muted-foreground", loading && "animate-spin")}
            />
          </button>
        </div>
      </div>

      {/* Connection list */}
      {!loading && !error && connections.length > 0 && (
        <div className="space-y-1.5">
          {connections.map((conn) => (
            <div
              key={conn.connection_id}
              className="flex items-center gap-3 p-3 rounded-xl bg-card/40 border border-border/20"
            >
              <span className="text-lg">
                {appIcons[conn.app] || "🔗"}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {formatAppName(conn.app)}
                </p>
                {conn.metadata && (conn.metadata as Record<string, string>).email && (
                  <p className="text-xs text-muted-foreground truncate">
                    {(conn.metadata as Record<string, string>).email}
                  </p>
                )}
              </div>
              {conn.status === "ACTIVE" ? (
                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-destructive shrink-0" />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="p-3 rounded-xl bg-destructive/5 border border-destructive/20 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && connections.length === 0 && (
        <div className="p-4 rounded-xl bg-muted/30 text-center">
          <p className="text-sm text-muted-foreground">No connections yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Connect apps through Maton to see them here
          </p>
        </div>
      )}

      {/* Link to Maton dashboard */}
      <a
        href="https://www.maton.ai/dashboard"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 p-3 rounded-xl bg-muted/40 hover:bg-muted/60 transition-colors text-sm text-muted-foreground hover:text-foreground"
      >
        <ExternalLink className="w-4 h-4" />
        Manage in Maton Dashboard
      </a>
    </SettingsSection>
  );
};
