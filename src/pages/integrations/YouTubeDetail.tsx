import { useEffect, useState, useCallback, useRef } from "react";
import { Youtube, AlertCircle, Loader2, Upload, Shield } from "lucide-react";
import { toast } from "sonner";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { ApiKeyInput } from "@/components/integrations/ApiKeyInput";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

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

const YOUTUBE_PENDING_OAUTH_CODE_KEY = "youtube_pending_oauth_code";

export default function YouTubeDetail() {
  const { session, authLoading } = useAuth();
  const { getIntegration, setStatus, setLastSync, setApiKeyConfigured, updateSettings } =
    useIntegrationsStore();
  const integration = getIntegration("youtube");
  const settings = integration.settings as { connectionId?: string; channelId?: string };

  const [channelId, setChannelId] = useState(settings.channelId || "");
  const [accountLabel, setAccountLabel] = useState("Primary YouTube");
  const [loadingConnection, setLoadingConnection] = useState(true);

  const [savedConn, setSavedConn] = useState<SavedConnection | null>(null);
  const [savingKey, setSavingKey] = useState(false);

  const [oauthConnected, setOauthConnected] = useState(false);
  const [oauthDetail, setOauthDetail] = useState<OAuthDetail>("unknown");
  const [authorizing, setAuthorizing] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadVideoUrl, setUploadVideoUrl] = useState("");
  const [uploadPrivacy, setUploadPrivacy] = useState("private");
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const hasLoadedOnce = useRef(false);
  const oauthHandledRef = useRef(false);
  const autoSyncAttemptedRef = useRef(false);

  const withTimeout = <T,>(promise: Promise<T>, ms = 8000): Promise<T> =>
    Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
    ]);

  const callYouTube = async (action: string, params: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.functions.invoke("youtube", {
      headers: session?.access_token
        ? {
            Authorization: `Bearer ${session.access_token}`,
          }
        : undefined,
      body: { action, params },
    });
    if (error) throw new Error(error.message);
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    return data;
  };

  const loadConnectionWithRetry = useCallback(async (attempts = 4) => {
    let lastOauthStatus: OAuthDetail = "disconnected";

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = await withTimeout(callYouTube("get_connection"));
      hasLoadedOnce.current = true;

      const conn = result.connection as SavedConnection | null;
      if (conn) {
        setSavedConn(conn);
        setChannelId(conn.channelId || "");
        setAccountLabel(conn.accountLabel || "Primary YouTube");
        updateSettings("youtube", { connectionId: conn.id, channelId: conn.channelId });
        setStatus("youtube", conn.status === "connected" ? "connected" : "disconnected");
        setApiKeyConfigured("youtube", conn.apiKeyConfigured);
      }

      const oauthStatus = (result.oauthStatus as OAuthDetail) || "disconnected";
      lastOauthStatus = oauthStatus;
      setOauthDetail(oauthStatus);
      setOauthConnected(oauthStatus === "connected" || oauthStatus === "refreshed");

      if (oauthStatus === "connected" || oauthStatus === "refreshed") {
        return oauthStatus;
      }

      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
    }

    return lastOauthStatus;
  }, [session?.access_token, setApiKeyConfigured, setStatus, updateSettings]);

  const loadConnection = useCallback(async () => {
    setLoadingConnection(true);
    try {
      await loadConnectionWithRetry(1);
    } catch {
      if (!hasLoadedOnce.current) {
        // First load failed — show disconnected
      }
    } finally {
      setLoadingConnection(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConnectionWithRetry]);

  const syncYouTubeData = useCallback(async (
    options?: { connectionId?: string | null; channelId?: string | null; silent?: boolean }
  ) => {
    const nextConnectionId = options?.connectionId || savedConn?.id || settings.connectionId;
    const nextChannelId = (options?.channelId || savedConn?.channelId || channelId || "").trim();

    if (!nextConnectionId) {
      if (!options?.silent) toast.error("Connect the YouTube Data API first");
      return false;
    }

    if (!nextChannelId) {
      if (!options?.silent) toast.error("Add your YouTube channel ID first");
      return false;
    }

    setSyncing(true);
    try {
      await callYouTube("sync_channels", {
        connectionId: nextConnectionId,
        channelId: nextChannelId,
      });
      await callYouTube("sync_videos", {
        connectionId: nextConnectionId,
        channelId: nextChannelId,
        maxResults: 10,
      });

      const now = new Date().toISOString();
      setLastSync("youtube", now);
      setSavedConn((prev) => prev ? { ...prev, lastSyncAt: now, channelId: nextChannelId } : prev);

      if (!options?.silent) {
        toast.success("YouTube data synced");
      }
      return true;
    } catch (e) {
      if (!options?.silent) {
        toast.error(`Sync failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      }
      return false;
    } finally {
      setSyncing(false);
    }
  }, [callYouTube, channelId, savedConn, setLastSync, settings.connectionId]);

  const handleOAuthCallback = useCallback(async (code: string) => {
    try {
      await callYouTube("oauth_callback", {
        code,
        redirectUri: `${window.location.origin}/integrations/youtube`,
      });

      const oauthStatus = await loadConnectionWithRetry();
      if (oauthStatus === "connected" || oauthStatus === "refreshed") {
        toast.success("YouTube OAuth connected — uploads enabled!");
        return;
      }

      throw new Error("OAuth completed but the connection status did not persist");
    } catch (e) {
      toast.error(`OAuth failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  }, [loadConnectionWithRetry, session?.access_token]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error");
    const oauthErrorDescription = url.searchParams.get("error_description");

    if (code) {
      sessionStorage.setItem(YOUTUBE_PENDING_OAUTH_CODE_KEY, code);
    }

    if (oauthError) {
      sessionStorage.removeItem(YOUTUBE_PENDING_OAUTH_CODE_KEY);
      url.searchParams.delete("error");
      url.searchParams.delete("error_description");
      url.searchParams.delete("state");
      window.history.replaceState({}, "", url.toString());
      toast.error(`OAuth failed: ${oauthErrorDescription || oauthError}`);
      if (!authLoading && session) {
        loadConnection();
      } else {
        setLoadingConnection(false);
      }
      return;
    }

    if (authLoading) {
      return;
    }

    if (!session) {
      setLoadingConnection(false);
      return;
    }

    const pendingCode = sessionStorage.getItem(YOUTUBE_PENDING_OAUTH_CODE_KEY);

    if (pendingCode && !oauthHandledRef.current) {
      oauthHandledRef.current = true;
      setLoadingConnection(true);
      sessionStorage.removeItem(YOUTUBE_PENDING_OAUTH_CODE_KEY);
      url.searchParams.delete("code");
      url.searchParams.delete("state");
      url.searchParams.delete("scope");
      window.history.replaceState({}, "", url.toString());

      (async () => {
        await handleOAuthCallback(pendingCode);
        setLoadingConnection(false);
      })();
    } else {
      loadConnection();
    }
  }, [authLoading, handleOAuthCallback, loadConnection, session]);

  useEffect(() => {
    if (
      loadingConnection ||
      autoSyncAttemptedRef.current ||
      savedConn?.status !== "connected" ||
      !savedConn.channelId ||
      savedConn.lastSyncAt
    ) {
      return;
    }

    autoSyncAttemptedRef.current = true;
    void syncYouTubeData({
      connectionId: savedConn.id,
      channelId: savedConn.channelId,
      silent: true,
    });
  }, [loadingConnection, savedConn, syncYouTubeData]);

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
      if (connection.external_account_id || channelId.trim()) {
        await syncYouTubeData({
          connectionId: connection.id,
          channelId: connection.external_account_id || channelId.trim(),
          silent: false,
        });
      }
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
        apiKey: "",
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
      if (connection.external_account_id || channelId.trim()) {
        await syncYouTubeData({
          connectionId: connection.id,
          channelId: connection.external_account_id || channelId.trim(),
          silent: false,
        });
      }
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
  const isConnected = isApiKeyConnected;

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

  if (loadingConnection || authLoading) {
    return (
      <IntegrationDetailLayout
        name="YouTube"
        description="Connect your YouTube account to manage and upload videos"
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
      description="Connect your YouTube account to manage and upload videos"
      icon={Youtube}
      status={integration.status}
      actions={
        isConnected ? (
          <>
            <button
              onClick={() => void syncYouTubeData()}
              disabled={syncing}
              className={cn(
                secondaryBtnClass,
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
              Sync Now
            </button>
            <button
              onClick={handleDisconnect}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
            >
              Disconnect
            </button>
          </>
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
    </IntegrationDetailLayout>
  );
}
