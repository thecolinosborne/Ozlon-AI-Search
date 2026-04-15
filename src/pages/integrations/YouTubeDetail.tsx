import { useEffect, useState } from "react";
import { Youtube, Link as LinkIcon, RefreshCw, Film, AlertCircle, Loader2, Upload, Shield } from "lucide-react";
import { toast } from "sonner";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";

import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface SyncRun {
  id: string;
  status: string;
  records_processed: number;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export default function YouTubeDetail() {
  const { getIntegration, setStatus, setLastSync, setApiKeyConfigured, updateSettings } =
    useIntegrationsStore();
  const integration = getIntegration("youtube");
  const settings = integration.settings as { connectionId?: string; channelId?: string };

  const [apiKey, setApiKey] = useState("");
  const [channelId, setChannelId] = useState(settings.channelId || "");
  const [accountLabel, setAccountLabel] = useState("Primary YouTube");
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncingChannels, setSyncingChannels] = useState(false);
  const [syncingVideos, setSyncingVideos] = useState(false);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  // OAuth state
  const [oauthConnected, setOauthConnected] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadVideoUrl, setUploadVideoUrl] = useState("");
  const [uploadPrivacy, setUploadPrivacy] = useState("private");
  const [uploading, setUploading] = useState(false);

  const callYouTube = async (action: string, params: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("youtube", {
      body: { action, params },
    });
    if (error) throw new Error(error.message);
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    return data;
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

  const checkOAuthStatus = async () => {
    try {
      const result = await callYouTube("oauth_status");
      setOauthConnected(!!result.oauth_connected);
    } catch {
      // not connected
    }
  };

  useEffect(() => {
    loadRuns();
    checkOAuthStatus();

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
  }, [settings.connectionId]);

  const handleOAuthCallback = async (code: string) => {
    try {
      await callYouTube("oauth_callback", {
        code,
        redirectUri: `${window.location.origin}/integrations/youtube`,
      });
      setOauthConnected(true);
      toast.success("YouTube OAuth connected — uploads enabled!");
    } catch (e) {
      toast.error(`OAuth failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  };

  const handleConnect = async () => {
    if (!apiKey.trim()) {
      toast.error("YouTube API key is required");
      return;
    }
    setConnecting(true);
    try {
      const result = await callYouTube("connect", {
        apiKey: apiKey.trim(),
        channelId: channelId.trim() || null,
        accountLabel: accountLabel.trim() || "Primary YouTube",
      });
      const connection = result.connection as { id: string; external_account_id?: string | null };
      updateSettings("youtube", {
        connectionId: connection.id,
        channelId: connection.external_account_id || channelId || "",
      });
      setStatus("youtube", "connected");
      setApiKeyConfigured("youtube", true);
      setLastSync("youtube", new Date().toISOString());
      toast.success("YouTube connected");
      await loadRuns(connection.id);
    } catch (e) {
      setStatus("youtube", "error");
      toast.error(`Connect failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      toast.error("Enter API key to test");
      return;
    }
    setTesting(true);
    try {
      await callYouTube("test_connection", { apiKey: apiKey.trim() });
      toast.success("Connection verified");
    } catch (e) {
      toast.error(`Connection failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setTesting(false);
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
    const connectionId = (integration.settings as { connectionId?: string }).connectionId;
    if (!connectionId) { toast.error("Connect YouTube first"); return; }
    if (!apiKey.trim()) { toast.error("Enter API key to sync"); return; }
    if (!channelId.trim()) { toast.error("Channel ID is required"); return; }

    if (action === "sync_channels") setSyncingChannels(true);
    else setSyncingVideos(true);
    setStatus("youtube", "syncing");
    try {
      const result = await callYouTube(action, {
        apiKey: apiKey.trim(),
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
    const connectionId = (integration.settings as { connectionId?: string }).connectionId;
    if (!connectionId) {
      setStatus("youtube", "disconnected");
      setApiKeyConfigured("youtube", false);
      return;
    }
    try {
      await callYouTube("disconnect", { connectionId });
      setStatus("youtube", "disconnected");
      setApiKeyConfigured("youtube", false);
      updateSettings("youtube", { connectionId: null });
      toast.success("YouTube disconnected");
    } catch (e) {
      toast.error(`Disconnect failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  };

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

  return (
    <IntegrationDetailLayout
      name="YouTube"
      description="Connect by API key, sync channels/videos, authorize OAuth for uploads"
      icon={Youtube}
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
      {/* Connect Section */}
      <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
        <div className="flex items-center gap-2">
          <LinkIcon className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
          <h3 className="text-sm font-medium text-foreground">Connect YouTube</h3>
        </div>
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="YouTube Data API key" className={inputClass} />
        <input type="text" value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder="Channel ID (UC...)" className={inputClass} />
        <input type="text" value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)} placeholder="Account label" className={inputClass} />
        <div className="flex flex-wrap gap-2">
          <button onClick={handleConnect} disabled={connecting} className={actionBtnClass}>
            {connecting ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}Connect
          </button>
          <button onClick={handleTestConnection} disabled={testing} className={secondaryBtnClass}>
            {testing ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}Test
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">API key is used for read-only sync. OAuth below is needed for uploads.</p>
      </div>

      {/* OAuth Section */}
      <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
          <h3 className="text-sm font-medium text-foreground">YouTube OAuth (Uploads)</h3>
          {oauthConnected && (
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Connected</span>
          )}
        </div>
        {oauthConnected ? (
          <p className="text-xs text-muted-foreground">OAuth is active — you can upload videos below.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Authorize with Google to enable video uploads. Requires <code className="text-foreground">YOUTUBE_CLIENT_ID</code> and <code className="text-foreground">YOUTUBE_CLIENT_SECRET</code> configured as backend secrets.
            </p>
            <button onClick={handleAuthorize} disabled={authorizing} className={actionBtnClass}>
              {authorizing ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <Shield className="w-4 h-4 inline mr-1" />}
              Authorize YouTube Uploads
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

      {/* Sync Runs */}
      <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Recent Sync Runs</h3>
          <button onClick={() => loadRuns()} className={secondaryBtnClass} disabled={loadingRuns}>
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
    </IntegrationDetailLayout>
  );
}
