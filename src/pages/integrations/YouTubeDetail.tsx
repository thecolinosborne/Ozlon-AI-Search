import { useEffect, useState, useCallback, useRef } from "react";
import { Youtube, RefreshCw, Film, AlertCircle, Loader2, Upload, Shield } from "lucide-react";
import { toast } from "sonner";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { ApiKeyInput } from "@/components/integrations/ApiKeyInput";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface SyncRun {
  id: string;
  status: string;
  records_processed: number;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
}

interface SavedConnection {
  id: string;
  status: string;
  channelId: string;
  accountLabel: string;
  apiKeyMasked: string;
  apiKeyConfigured: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
}

type OAuthDetail = "connected" | "refreshed" | "expired" | "refresh_failed" | "expired_no_refresh" | "disconnected" | "unknown";

export default function YouTubeDetail() {
  const { session, authLoading } = useAuth();
  const { getIntegration, setStatus, setLastSync, setApiKeyConfigured, updateSettings } =
    useIntegrationsStore();
  const integration = getIntegration("youtube");
  const settings = integration.settings as { connectionId?: string; channelId?: string };

  const [channelId, setChannelId] = useState(settings.channelId || "");
  const [accountLabel, setAccountLabel] = useState("Primary YouTube");
  const [syncingChannels, setSyncingChannels] = useState(false);
  const [syncingVideos, setSyncingVideos] = useState(false);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingConnection, setLoadingConnection] = useState(true);

  // Saved API-key connection state
  const [savedConn, setSavedConn] = useState<SavedConnection | null>(null);
  const [savingKey, setSavingKey] = useState(false);

  // OAuth state — separate from API key
  const [oauthConnected, setOauthConnected] = useState(false);
  const [oauthDetail, setOauthDetail] = useState<OAuthDetail>("unknown");
  const [authorizing, setAuthorizing] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadVideoUrl, setUploadVideoUrl] = useState("");
  const [uploadPrivacy, setUploadPrivacy] = useState("private");
  const [uploading, setUploading] = useState(false);

  // Track whether we've ever loaded successfully to avoid false disconnects
  const hasLoadedOnce = useRef(false);

  const withTimeout = <T,>(promise: Promise<T>, ms = 8000): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
    ]);

  const callYouTube = async (action: string, params: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("youtube", {
      body: { action, params },
    });
    if (error) throw new Error(error.message);
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    return data;
  };

  const loadConnection = useCallback(async () => {
    setLoadingConnection(true);
    try {
      const result = await withTimeout(callYouTube("get_connection"));
      hasLoadedOnce.current = true;

      // API key connection
      const conn = result.connection as SavedConnection | null;
      if (conn) {
        setSavedConn(conn);
        setChannelId(conn.channelId || "");
        setAccountLabel(conn.accountLabel || "Primary YouTube");
        updateSettings("youtube", { connectionId: conn.id, channelId: conn.channelId });
        setStatus("youtube", conn.status === "connected" ? "connected" : "disconnected");
        setApiKeyConfigured("youtube", conn.apiKeyConfigured);
      }

      // OAuth status from same response
      const oStatus = (result.oauthStatus as OAuthDetail) || "disconnected";
      setOauthDetail(oStatus);
      setOauthConnected(oStatus === "connected" || oStatus === "refreshed");
    } catch {
      // On timeout/error: if we've never loaded, just show disconnected
      // If we have loaded before, keep existing state (don't false-disconnect)
      if (!hasLoadedOnce.current) {
        // First load failed — show page as disconnected but don't error
      }
      // Otherwise keep existing savedConn and oauthConnected as-is
    } finally {
      setLoadingConnection(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadConnection();

    // Handle OAuth callback code in URL
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (code) {
      url.searchParams.delete("code");
      url.searchParams.delete("state");
      url.searchParams.delete("scope");
      window.history.replaceState({}, "", url.toString());
      handleOAuthCallback(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load runs when connectionId becomes available
  useEffect(() => {
    if (savedConn?.id) loadRuns(savedConn.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedConn?.id]);

  const handleOAuthCallback = async (code: string) => {
    try {
      await callYouTube("oauth_callback", {
        code,
        redirectUri: `${window.location.origin}/integrations/youtube`,
      });
      setOauthConnected(true);
      setOauthDetail("connected");
      toast.success("YouTube OAuth connected — uploads enabled!");
    } catch (e) {
      toast.error(`OAuth failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  };

  const loadRuns = async (connectionId = settings.connectionId) => {
    if (!connectionId) return;
    setLoadingRuns(true);
    try {
      const result = await callYouTube("list_sync_runs", { connectionId });
      setRuns((result.runs || []) as SyncRun[]);
    } catch (e) {
      toast.error(`Failed to fetch sync history: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setLoadingRuns(false);
    }
  };

  const handleSaveApiKey = async (apiKey: string) => {
    setSavingKey(true);
    try {
      const result = await callYouTube("connect", {
        apiKey,
        channelId: channelId.trim() || null,
        accountLabel: accountLabel.trim() || "Primary YouTube",
      });
      const connection = result.connection as { id: string; external_account_id?: string | null };
      const masked = result.apiKeyMasked as string;
      updateSettings("youtube", {
        connectionId: connection.id,
        channelId: connection.external_account_id || channelId || "",
      });
      setStatus("youtube", "connected");
      setApiKeyConfigured("youtube", true);
      setLastSync("youtube", new Date().toISOString());
      setSavedConn((prev) => ({
        ...(prev || { lastSyncAt: null, lastError: null }),
        id: connection.id,
        status: "connected",
        channelId: connection.external_account_id || channelId || "",
        accountLabel: accountLabel.trim() || "Primary YouTube",
        apiKeyMasked: masked,
        apiKeyConfigured: true,
      }));
      hasLoadedOnce.current = true;
      toast.success("YouTube API key saved and validated");
      await loadRuns(connection.id);
      return true;
    } catch (e) {
      setStatus("youtube", "error");
      console.error("YouTube connect failed", e);
      toast.error(`Connect failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      return false;
    } finally {
      setSavingKey(false);
    }
  };

  const handleUpdateChannel = async () => {
    setSavingKey(true);
    try {
      const result = await callYouTube("connect", {
        apiKey: "", // empty = update metadata only
        channelId: channelId.trim() || null,
        accountLabel: accountLabel.trim() || "Primary YouTube",
      });
      const connection = result.connection as { id: string; external_account_id?: string | null };
      updateSettings("youtube", { channelId: channelId.trim() });
      setSavedConn((prev) => prev ? {
        ...prev,
        channelId: connection.external_account_id || channelId || "",
        accountLabel: accountLabel.trim() || "Primary YouTube",
      } : prev);
      toast.success("Channel settings updated");
    } catch (e) {
      toast.error(`Update failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setSavingKey(false);
    }
  };

  const handleAuthorize = async () => {
    setAuthorizing(true);
    try {
      const result = await callYouTube("oauth_authorize", {
        redirectUri: `${window.location.origin}/integrations/youtube`,
      });
      window.location.href = result.authUrl;
    } catch (e) {
      toast.error(`OAuth failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      setAuthorizing(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadVideoUrl.trim()) {
      toast.error("Video URL is required");
      return;
    }
    setUploading(true);
    try {
      const result = await callYouTube("upload_video", {
        title: uploadTitle.trim() || "Untitled",
        description: uploadDescription.trim(),
        privacyStatus: uploadPrivacy,
        videoUrl: uploadVideoUrl.trim(),
      });
      toast.success(`Uploaded! Video ID: ${result.videoId}`);
      setUploadTitle("");
      setUploadDescription("");
      setUploadVideoUrl("");
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setUploading(false);
    }
  };

  const runSync = async (action: "sync_channels" | "sync_videos") => {
    const connectionId = savedConn?.id || settings.connectionId;
    if (!connectionId) { toast.error("Connect YouTube first"); return; }
    if (!channelId.trim()) { toast.error("Channel ID is required"); return; }

    if (action === "sync_channels") setSyncingChannels(true);
    else setSyncingVideos(true);
    setStatus("youtube", "syncing");
    try {
      const result = await callYouTube(action, {
        connectionId,
        channelId: channelId.trim(),
      });
      setStatus("youtube", "connected");
      setLastSync("youtube", new Date().toISOString());
      updateSettings("youtube", { channelId: channelId.trim() });
      toast.success(`Synced ${result.recordsProcessed || 0} records`);
      await loadRuns(connectionId);
    } catch (e) {
      setStatus("youtube", "error");
      toast.error(`Sync failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setSyncingChannels(false);
      setSyncingVideos(false);
    }
  };

  const handleDisconnect = async () => {
    const connectionId = savedConn?.id || settings.connectionId;
    if (!connectionId) {
      setStatus("youtube", "disconnected");
      setApiKeyConfigured("youtube", false);
      setSavedConn(null);
      return;
    }
    try {
      await callYouTube("disconnect", { connectionId });
      setStatus("youtube", "disconnected");
      setApiKeyConfigured("youtube", false);
      updateSettings("youtube", { connectionId: null });
      setSavedConn(null);
      toast.success("YouTube disconnected");
    } catch (e) {
      toast.error(`Disconnect failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  };

  const isApiKeyConnected = savedConn?.status === "connected" || integration.status === "connected";
  const isConnected = isApiKeyConnected; // Data API connected = core connected

  const inputClass = cn(
    "w-full px-3 py-2 rounded-xl border border-border bg-background text-sm",
    "focus:outline-none focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground",
  );
  const actionBtnClass = cn(
    "px-4 py-2 rounded-xl text-sm font-medium transition-colors",
    "bg-primary text-primary-foreground hover:bg-primary/90",
    "disabled:opacity-50 disabled:cursor-not-allowed",
  );
  const secondaryBtnClass = cn(
    "px-4 py-2 rounded-xl text-sm font-medium transition-colors",
    "border border-border hover:bg-muted/60 text-foreground",
  );

  if (loadingConnection) {
    return (
      <IntegrationDetailLayout
        name="YouTube"
        description="Connect by API key, sync channels/videos, authorize OAuth for uploads"
        icon={Youtube}
        status={integration.status}
      >
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      </IntegrationDetailLayout>
    );
  }

  return (
    <IntegrationDetailLayout
      name="YouTube"
      description="Connect by API key, sync channels/videos, authorize OAuth for uploads"
      icon={Youtube}
      status={integration.status}
      actions={
        isConnected ? (
          <button
            onClick={handleDisconnect}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
          >
            Disconnect
          </button>
        ) : undefined
      }
    >
      {/* Connection Status Summary */}
      <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-2">
        <h3 className="text-sm font-medium text-foreground">Connection Status</h3>
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <div className={cn("w-2 h-2 rounded-full", isApiKeyConnected ? "bg-primary" : "bg-muted-foreground/40")} />
            <span className="text-muted-foreground">Data API</span>
            <span className="font-medium text-foreground">{isApiKeyConnected ? "Connected" : "Not connected"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={cn("w-2 h-2 rounded-full", oauthConnected ? "bg-primary" : oauthDetail === "refresh_failed" || oauthDetail === "expired_no_refresh" ? "bg-amber-500" : "bg-muted-foreground/40")} />
            <span className="text-muted-foreground">OAuth (Uploads)</span>
            <span className="font-medium text-foreground">
              {oauthConnected ? "Active" : oauthDetail === "refresh_failed" ? "Expired — re-authorize" : oauthDetail === "expired_no_refresh" ? "Expired" : "Not connected"}
            </span>
          </div>
        </div>
        {savedConn?.lastError && (
          <div className="p-2 rounded-lg bg-destructive/10 text-destructive text-xs flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {savedConn.lastError}
          </div>
        )}
        <div className="pt-1 border-t border-border/20">
          <p className="text-[10px] text-muted-foreground/60 font-mono select-all break-all">
            Redirect URI: {window.location.origin}/integrations/youtube
          </p>
        </div>
      </div>

      {/* API Key */}
      <ApiKeyInput
        label="YouTube Data API Key"
        placeholder="Enter YouTube API key…"
        configured={!!savedConn?.apiKeyConfigured}
        onSave={handleSaveApiKey}
        saving={savingKey}
        maskedHint={savedConn?.apiKeyMasked}
      />

      {/* Channel ID + Label */}
      <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
        <h3 className="text-sm font-medium text-foreground">Channel Settings</h3>
        <input
          type="text"
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          placeholder="Channel ID (UC...)"
          className={inputClass}
        />
        <input
          type="text"
          value={accountLabel}
          onChange={(e) => setAccountLabel(e.target.value)}
          placeholder="Account label"
          className={inputClass}
        />
        {isConnected && channelId !== (savedConn?.channelId || "") && (
          <button
            onClick={handleUpdateChannel}
            disabled={savingKey}
            className={secondaryBtnClass}
          >
            {savingKey ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
            Update Channel
          </button>
        )}
      </div>

      {/* OAuth Section */}
      <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
          <h3 className="text-sm font-medium text-foreground">YouTube OAuth (Uploads)</h3>
          {oauthConnected && (
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Active</span>
          )}
        </div>
        {oauthConnected ? (
          <p className="text-xs text-muted-foreground">OAuth is active — you can upload videos below.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {oauthDetail === "refresh_failed" || oauthDetail === "expired_no_refresh"
                ? "Your OAuth token has expired. Re-authorize to enable uploads."
                : "Authorize with Google to enable video uploads. Requires OAuth credentials configured as backend secrets."}
            </p>
            <button onClick={handleAuthorize} disabled={authorizing} className={actionBtnClass}>
              {authorizing ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <Shield className="w-4 h-4 inline mr-1" />}
              {oauthDetail === "refresh_failed" || oauthDetail === "expired_no_refresh" ? "Re-authorize YouTube" : "Authorize YouTube Uploads"}
            </button>
          </>
        )}
      </div>

      {/* Upload Section */}
      {oauthConnected && (
        <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
            <h3 className="text-sm font-medium text-foreground">Upload Video</h3>
          </div>
          <input type="text" value={uploadVideoUrl} onChange={(e) => setUploadVideoUrl(e.target.value)} placeholder="Public video URL (https://...mp4)" className={inputClass} />
          <input type="text" value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="Video title" className={inputClass} />
          <textarea value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} placeholder="Video description" className={cn(inputClass, "min-h-[60px]")} />
          <select value={uploadPrivacy} onChange={(e) => setUploadPrivacy(e.target.value)} className={inputClass}>
            <option value="private">Private</option>
            <option value="unlisted">Unlisted</option>
            <option value="public">Public</option>
          </select>
          <button onClick={handleUpload} disabled={uploading} className={actionBtnClass}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <Upload className="w-4 h-4 inline mr-1" />}
            Upload to YouTube
          </button>
        </div>
      )}

      {/* Manual Sync */}
      {isConnected && (
        <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
            <h3 className="text-sm font-medium text-foreground">Manual Sync</h3>
          </div>
          {!channelId.trim() && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5" />Add a channel ID to run sync.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => runSync("sync_channels")} disabled={syncingChannels} className={actionBtnClass}>
              {syncingChannels ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <RefreshCw className="w-4 h-4 inline mr-1" />}Sync Channel
            </button>
            <button onClick={() => runSync("sync_videos")} disabled={syncingVideos} className={secondaryBtnClass}>
              {syncingVideos ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <RefreshCw className="w-4 h-4 inline mr-1" />}Sync Videos
            </button>
          </div>
        </div>
      )}

      {/* Sync Runs */}
      {isConnected && (
        <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">Recent Sync Runs</h3>
            <button onClick={() => loadRuns(savedConn?.id)} className={secondaryBtnClass} disabled={loadingRuns}>
              {loadingRuns ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}Refresh
            </button>
          </div>
          <div className="space-y-2">
            {runs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No sync runs yet.</p>
            ) : (
              runs.map((run) => (
                <div key={run.id} className="p-3 rounded-xl border border-border/40 bg-background/60 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{run.status}</span>
                    <span className="text-muted-foreground">{new Date(run.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-muted-foreground mt-1">Records: {run.records_processed}</p>
                  {run.error_message ? <p className="text-destructive mt-1">{run.error_message}</p> : null}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </IntegrationDetailLayout>
  );
}
