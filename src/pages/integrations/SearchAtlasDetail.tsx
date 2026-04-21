import { useState, useEffect, useCallback, useRef } from "react";
import { Search, RefreshCw } from "lucide-react";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { ApiKeyInput } from "@/components/integrations/ApiKeyInput";
import { SyncRunsList } from "@/components/integrations/SyncRunsList";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { upsertIntegrationConnection, disconnectIntegration } from "@/services/integrationConnectionService";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface SearchAtlasProject {
  id?: string | number;
  name?: string;
  domain?: string;
  [k: string]: unknown;
}

interface Snapshot {
  id: string;
  kind: string;
  domain: string | null;
  project_id: string | null;
  fetched_at: string;
  payload: unknown;
}

async function callSA(action: string, params?: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("search-atlas", {
    body: { action, params: params || {} },
  });
  if (error) {
    let serverMsg: string | null = null;
    try {
      const ctx = (error as unknown as { context?: { json?: () => Promise<{ error?: string }> } }).context;
      if (ctx?.json) {
        const parsed = await ctx.json();
        serverMsg = parsed?.error ?? null;
      }
    } catch { /* ignore */ }
    throw new Error(serverMsg || error.message || "Request failed");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

const SearchAtlasDetail = () => {
  const { session, authLoading } = useAuth();
  const { getIntegration, setStatus, setLastSync, updateSettings, setApiKeyConfigured } =
    useIntegrationsStore();
  const integration = getIntegration("search-atlas");
  const stored = integration.settings as { domain?: string; projectId?: string; apiKeyMask?: string };

  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncRefreshKey, setSyncRefreshKey] = useState(0);
  const [connectionId, setConnectionId] = useState<string | null>(null);

  const [domain, setDomain] = useState(stored.domain || "");
  const [projectId, setProjectId] = useState(stored.projectId || "");
  const [projects, setProjects] = useState<SearchAtlasProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const hydratedRef = useRef<string | null>(null);

  const isConnected = integration.status === "connected";

  const loadConnection = useCallback(async () => {
    if (authLoading) return;
    if (!session) {
      setStatus("search-atlas", "disconnected");
      setApiKeyConfigured("search-atlas", false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await callSA("test_connection");
      if (result.connected) {
        setStatus("search-atlas", "connected");
        setApiKeyConfigured("search-atlas", true);
        setLastSync("search-atlas", new Date().toISOString());
        try {
          const { data: conn } = await supabase
            .from("integration_connections")
            .select("id")
            .eq("user_id", session.user.id)
            .eq("provider", "search_atlas")
            .eq("status", "connected")
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (conn?.id) setConnectionId(conn.id);
        } catch { /* best effort */ }
      } else {
        setStatus("search-atlas", "disconnected");
        setApiKeyConfigured("search-atlas", false);
      }
    } catch {
      setStatus("search-atlas", "disconnected");
      setApiKeyConfigured("search-atlas", false);
    } finally {
      setLoading(false);
    }
  }, [authLoading, session, setApiKeyConfigured, setLastSync, setStatus]);

  useEffect(() => {
    if (authLoading) return;
    const key = session?.user.id ?? "signed-out";
    if (hydratedRef.current === key) return;
    hydratedRef.current = key;
    void loadConnection();
  }, [authLoading, session?.user.id, loadConnection]);

  const loadProjects = useCallback(async () => {
    if (!isConnected) return;
    setLoadingProjects(true);
    try {
      const data = await callSA("list_projects");
      const raw = data?.projects;
      const list: SearchAtlasProject[] = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.results) ? raw.results
        : Array.isArray(raw?.data) ? raw.data
        : [];
      setProjects(list);
    } catch (err) {
      // Non-blocking — projects endpoint may not be available on every plan.
      console.warn("[search-atlas] list_projects failed:", err);
    } finally {
      setLoadingProjects(false);
    }
  }, [isConnected]);

  const loadSnapshots = useCallback(async () => {
    if (!isConnected) return;
    try {
      const data = await callSA("recent_snapshots", { limit: 10 });
      setSnapshots((data?.snapshots || []) as Snapshot[]);
    } catch { /* best effort */ }
  }, [isConnected]);

  useEffect(() => {
    if (isConnected) {
      void loadProjects();
      void loadSnapshots();
    }
  }, [isConnected, loadProjects, loadSnapshots]);

  const handleSaveApiKey = async (token: string) => {
    setSavingKey(true);
    try {
      await upsertIntegrationConnection("search_atlas", { api_key: token });
      const result = await callSA("test_connection");
      if (!result.connected) {
        setStatus("search-atlas", "error");
        toast.error("Connection failed — check your API key");
        return false;
      }
      updateSettings("search-atlas", { apiKeyMask: "••••" + token.slice(-4) });
      setStatus("search-atlas", "connected");
      setApiKeyConfigured("search-atlas", true);
      setLastSync("search-atlas", new Date().toISOString());
      toast.success("Search Atlas connected");
      return true;
    } catch (err) {
      setStatus("search-atlas", "error");
      toast.error((err as Error).message);
      return false;
    } finally {
      setSavingKey(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await callSA("test_connection");
      if (result.connected) {
        toast.success("Connection healthy");
        setStatus("search-atlas", "connected");
        setLastSync("search-atlas", new Date().toISOString());
      } else {
        toast.error("Connection failed");
        setStatus("search-atlas", "error");
      }
    } catch (err) {
      toast.error((err as Error).message);
      setStatus("search-atlas", "error");
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    setStatus("search-atlas", "disconnected");
    setApiKeyConfigured("search-atlas", false);
    updateSettings("search-atlas", {});
    await disconnectIntegration("search_atlas");
    toast.success("Search Atlas disconnected");
  };

  const handleSaveDefaults = () => {
    updateSettings("search-atlas", { domain: domain.trim(), projectId: projectId.trim() });
    toast.success("Defaults saved");
  };

  const handleSync = async () => {
    if (!domain.trim() && !projectId.trim()) {
      toast.error("Set a default domain or project first");
      return;
    }
    setSyncing(true);
    setStatus("search-atlas", "syncing");
    try {
      const result = await callSA("sync_now", {
        domain: domain.trim() || undefined,
        projectId: projectId.trim() || undefined,
      });
      setStatus("search-atlas", "connected");
      setLastSync("search-atlas", new Date().toISOString());
      setSyncRefreshKey((k) => k + 1);
      void loadSnapshots();
      toast.success(`Synced ${result?.records_processed ?? 0} dataset(s)`);
    } catch (err) {
      setStatus("search-atlas", "error");
      setSyncRefreshKey((k) => k + 1);
      toast.error(`Sync failed: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  if (loading || authLoading) {
    return (
      <IntegrationDetailLayout
        name="Search Atlas"
        description="Site audit, keyword research, backlinks, and rank tracking"
        icon={Search}
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
      name="Search Atlas"
      description="Site audit, keyword research, backlinks, and rank tracking"
      icon={Search}
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
            onClick={handleTest}
            disabled={testing}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {testing ? "Testing…" : "Test"}
          </button>
        )
      }
    >
      <ApiKeyInput
        label="Search Atlas API Key"
        placeholder="Bearer token from your Search Atlas dashboard"
        configured={!!stored.apiKeyMask || isConnected}
        onSave={handleSaveApiKey}
        saving={savingKey}
        maskedHint={stored.apiKeyMask || (isConnected ? "•••••••• (server)" : undefined)}
      />

      {isConnected && (
        <>
          <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-4">
            <h3 className="text-sm font-medium text-foreground">Defaults</h3>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Default domain</Label>
              <Input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="example.com"
                className="h-9 text-sm rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Rank-tracker project {loadingProjects && "(loading…)"}
              </Label>
              {projects.length > 0 ? (
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger className="h-9 text-sm rounded-xl">
                    <SelectValue placeholder="Select a project…" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p, i) => {
                      const id = String(p.id ?? p.uuid ?? i);
                      const label = String(p.name || p.domain || `Project ${id}`);
                      return (
                        <SelectItem key={id} value={id}>{label}</SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  placeholder="Project ID (optional)"
                  className="h-9 text-sm rounded-xl"
                />
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSaveDefaults}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/80 transition-colors"
              >
                Save defaults
              </button>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex-1 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
          </div>

          {snapshots.length > 0 && (
            <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
              <h3 className="text-sm font-medium text-foreground">Recent snapshots</h3>
              <ul className="space-y-2">
                {snapshots.map((s) => (
                  <li key={s.id} className="flex items-center justify-between text-xs">
                    <span className="text-foreground/80">
                      <span className="font-medium">{s.kind}</span>
                      {s.domain && <span className="text-muted-foreground"> · {s.domain}</span>}
                      {s.project_id && <span className="text-muted-foreground"> · proj {s.project_id}</span>}
                    </span>
                    <span className="text-muted-foreground/70">
                      {new Date(s.fetched_at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {connectionId && (
            <SyncRunsList connectionId={connectionId} refreshKey={syncRefreshKey} />
          )}
        </>
      )}
    </IntegrationDetailLayout>
  );
};

export default SearchAtlasDetail;
