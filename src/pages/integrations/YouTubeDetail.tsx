import { useEffect, useState } from "react";
import { Youtube, Link as LinkIcon, RefreshCw, Film, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { SyncControl } from "@/components/integrations/SyncControl";
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
  const { getIntegration, setStatus, setSyncDirection, setLastSync, setApiKeyConfigured, updateSettings } =
    useIntegrationsStore();
  const integration = getIntegration("youtube");
  const settings = integration.settings as {
    connectionId?: string;
    channelId?: string;
    apiKey?: string;
    accountLabel?: string;
  };

  const [apiKey, setApiKey] = useState(settings.apiKey || "");
  const [channelId, setChannelId] = useState(settings.channelId || "");
  const [accountLabel, setAccountLabel] = useState(settings.accountLabel || "Primary YouTube");
  const [connecting, setConnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncingChannels, setSyncingChannels] = useState(false);
  const [syncingVideos, setSyncingVideos] = useState(false);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [oauthToken, setOauthToken] = useState("");
  const [uploadSourceUrl, setUploadSourceUrl] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadPrivacy, setUploadPrivacy] = useState<"private" | "unlisted" | "public">("private");
  const [uploading, setUploading] = useState(false);

  const withTimeout = async <T,>(promise: Promise<T>, timeoutMs = 12000): Promise<T> => {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out. Please check your connection and try again.")), timeoutMs)
      ),
    ]);
  };

  const callYouTube = async (action: string, params: Record<string, unknown> = {}) => {
    const { data, error } = await withTimeout(
      supabase.functions.invoke("youtube", {
        body: { action, params },
      })
    );
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

  useEffect(() => {
    const hydrateConnection = async () => {
      try {
        const result = await callYouTube("get_connection");
        const connection = result?.connection as
          | { id: string; status?: string; external_account_id?: string | null }
          | null
          | undefined;
        if (connection?.id) {
          updateSettings("youtube", {
            connectionId: connection.id,
            channelId: connection.external_account_id || "",
          });
          setChannelId(connection.external_account_id || "");
          setStatus("youtube", connection.status === "disconnected" ? "disconnected" : "connected");
          setApiKeyConfigured("youtube", true);
          await loadRuns(connection.id);
        }
      } catch {
        // no saved connection, remain disconnected
      }
    };
    hydrateConnection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        apiKey: apiKey.trim(),
        accountLabel: accountLabel.trim() || "Primary YouTube",
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

  const runSync = async (action: "sync_channels" | "sync_videos") => {
    const connectionId = (integration.settings as { connectionId?: string }).connectionId;
    if (!connectionId) {
      toast.error("Connect YouTube first");
      return;
    }
    if (!apiKey.trim()) {
      toast.error("Enter API key to sync");
      return;
    }
    if (!channelId.trim()) {
      toast.error("Channel ID is required");
      return;
    }

    if (action === "sync_channels") {
      setSyncingChannels(true);
    } else {
      setSyncingVideos(true);
    }
    setStatus("youtube", "syncing");
    try {
      const result = await callYouTube(action, {
        apiKey: apiKey.trim(),
        connectionId,
        channelId: channelId.trim(),
      });
      setStatus("youtube", "connected");
      setLastSync("youtube", new Date().toISOString());
      updateSettings("youtube", {
        channelId: channelId.trim(),
        apiKey: apiKey.trim(),
        accountLabel: accountLabel.trim() || "Primary YouTube",
      });
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
      updateSettings("youtube", { connectionId: null, channelId: "" });
      setRuns([]);
      toast.success("YouTube disconnected");
    } catch (e) {
      toast.error(`Disconnect failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  };

  const handleUploadVideo = async () => {
    if (!oauthToken.trim()) {
      toast.error("OAuth access token is required for uploads");
      return;
    }
    if (!uploadSourceUrl.trim()) {
      toast.error("Video source URL is required");
      return;
    }
    if (!uploadTitle.trim()) {
      toast.error("Video title is required");
      return;
    }

    setUploading(true);
    try {
      const result = await callYouTube("upload_video", {
        accessToken: oauthToken.trim(),
        sourceUrl: uploadSourceUrl.trim(),
        title: uploadTitle.trim(),
        description: uploadDescription.trim(),
        privacyStatus: uploadPrivacy,
      });
      toast.success(`Uploaded to YouTube: ${result.videoId}`);
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setUploading(false);
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
      description="Connect by API key, sync channels/videos, and monitor run history"
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
      <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
        <div className="flex items-center gap-2">
          <LinkIcon className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
          <h3 className="text-sm font-medium text-foreground">Connect YouTube</h3>
        </div>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="YouTube Data API key"
          className={inputClass}
        />
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
        <div className="flex flex-wrap gap-2">
          <button onClick={handleConnect} disabled={connecting} className={actionBtnClass}>
            {connecting ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
            Connect
          </button>
          <button onClick={handleTestConnection} disabled={testing} className={secondaryBtnClass}>
            {testing ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
            Test
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          API key is used for validation and sync calls. For production, move secret handling fully backend-side.
        </p>
      </div>

      <SyncControl
        direction={integration.syncDirection}
        onDirectionChange={(d) => setSyncDirection("youtube", d)}
        lastSync={integration.lastSync}
      />

      <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
        <div className="flex items-center gap-2">
          <Film className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
          <h3 className="text-sm font-medium text-foreground">Manual Sync</h3>
        </div>
        {!channelId.trim() && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5" />
            Add a channel ID to run sync.
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => runSync("sync_channels")} disabled={syncingChannels} className={actionBtnClass}>
            {syncingChannels ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <RefreshCw className="w-4 h-4 inline mr-1" />}
            Sync Channel
          </button>
          <button onClick={() => runSync("sync_videos")} disabled={syncingVideos} className={secondaryBtnClass}>
            {syncingVideos ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <RefreshCw className="w-4 h-4 inline mr-1" />}
            Sync Videos
          </button>
        </div>
      </div>

      <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
        <h3 className="text-sm font-medium text-foreground">Upload Video (Google Drive / URL)</h3>
        <p className="text-[11px] text-muted-foreground">
          Upload requires a YouTube OAuth access token (API keys cannot upload). Paste a Google Drive share link or
          direct video URL.
        </p>
        <input
          type="password"
          value={oauthToken}
          onChange={(e) => setOauthToken(e.target.value)}
          placeholder="YouTube OAuth access token"
          className={inputClass}
        />
        <input
          type="text"
          value={uploadSourceUrl}
          onChange={(e) => setUploadSourceUrl(e.target.value)}
          placeholder="Google Drive link or direct video URL"
          className={inputClass}
        />
        <input
          type="text"
          value={uploadTitle}
          onChange={(e) => setUploadTitle(e.target.value)}
          placeholder="Video title"
          className={inputClass}
        />
        <textarea
          value={uploadDescription}
          onChange={(e) => setUploadDescription(e.target.value)}
          placeholder="Video description (optional)"
          className={inputClass}
          rows={3}
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setUploadPrivacy("private")}
            className={uploadPrivacy === "private" ? actionBtnClass : secondaryBtnClass}
          >
            Private
          </button>
          <button
            onClick={() => setUploadPrivacy("unlisted")}
            className={uploadPrivacy === "unlisted" ? actionBtnClass : secondaryBtnClass}
          >
            Unlisted
          </button>
          <button
            onClick={() => setUploadPrivacy("public")}
            className={uploadPrivacy === "public" ? actionBtnClass : secondaryBtnClass}
          >
            Public
          </button>
        </div>
        <button onClick={handleUploadVideo} disabled={uploading} className={actionBtnClass}>
          {uploading ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
          Upload to YouTube
        </button>
      </div>

      <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Recent Sync Runs</h3>
          <button onClick={() => loadRuns()} className={secondaryBtnClass} disabled={loadingRuns}>
            {loadingRuns ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
            Refresh
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
