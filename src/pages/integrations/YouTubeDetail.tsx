import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import {
  Youtube, AlertCircle, Loader2, Upload, Shield, ChevronDown, ChevronUp,
  Mail, HardDrive, Calendar, FileSpreadsheet, FileText, Presentation, BarChart3, Search, Tag,
} from "lucide-react";
import { toast } from "sonner";
import { IntegrationDetailLayout } from "@/components/integrations/IntegrationDetailLayout";
import { SyncRunsList } from "@/components/integrations/SyncRunsList";
import { ApiKeyInput } from "@/components/integrations/ApiKeyInput";
import { useIntegrationsStore } from "@/stores/useIntegrationsStore";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

function normalizeVideoUrl(url: string): string {
  const driveFileMatch = url.match(/drive\.google\.com\/file\/d\/([^\/]+)/);
  const driveOpenMatch = !driveFileMatch && url.match(/drive\.google\.com\/open\?id=([^&]+)/);
  const driveId = driveFileMatch?.[1] || driveOpenMatch?.[1];
  if (driveId) {
    return `https://drive.google.com/uc?export=download&confirm=t&id=${driveId}`;
  }
  return url;
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

const YOUTUBE_PENDING_OAUTH_CODE_KEY = "youtube_pending_oauth_code";

const SISTER_GOOGLE_SERVICES = [
  { id: "gmail", name: "Gmail", icon: Mail, path: "/integrations/gmail" },
  { id: "google-drive", name: "Drive", icon: HardDrive, path: "/integrations/google-drive" },
  { id: "google-calendar", name: "Calendar", icon: Calendar, path: "/integrations/google-calendar" },
  { id: "google-sheets", name: "Sheets", icon: FileSpreadsheet, path: "/integrations/google-sheets" },
  { id: "google-docs", name: "Docs", icon: FileText, path: "/integrations/google-docs" },
  { id: "google-slides", name: "Slides", icon: Presentation, path: "/integrations/google-slides" },
  { id: "google-analytics", name: "Analytics", icon: BarChart3, path: "/integrations/google-analytics" },
  { id: "google-search-console", name: "Search Console", icon: Search, path: "/integrations/google-search-console" },
  { id: "google-tag-manager", name: "Tag Manager", icon: Tag, path: "/integrations/google-tag-manager" },
] as const;

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
  const [driveConverted, setDriveConverted] = useState(false);
  const [uploadPrivacy, setUploadPrivacy] = useState("private");
  const [uploading, setUploading] = useState(false);

  // ── Expanded upload fields ──
  const [tagsInput, setTagsInput] = useState("");
  const [hashtagsInput, setHashtagsInput] = useState("");
  const [categoryId, setCategoryId] = useState("22");
  const [language, setLanguage] = useState("");
  const [defaultAudioLanguage, setDefaultAudioLanguage] = useState("");
  const [publishAt, setPublishAt] = useState("");
  const [madeForKids, setMadeForKids] = useState(false);
  const [notifySubscribers, setNotifySubscribers] = useState(true);
  const [recordingDate, setRecordingDate] = useState("");
  const [locationDescription, setLocationDescription] = useState("");
  const [chapters, setChapters] = useState<Array<{ timestamp: string; title: string }>>([]);
  const [captionsUrl, setCaptionsUrl] = useState("");
  const [captionsLanguage, setCaptionsLanguage] = useState("en");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [playlistId, setPlaylistId] = useState("");
  const [playlistName, setPlaylistName] = useState("");
  const [pinnedComment, setPinnedComment] = useState("");
  const [license, setLicense] = useState("youtube");
  const [embeddable, setEmbeddable] = useState(true);
  const [publicStatsViewable, setPublicStatsViewable] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [categoriesList, setCategoriesList] = useState<Array<{ id: string; title: string }>>([]);
  const [playlistsList, setPlaylistsList] = useState<Array<{ id: string; title: string }>>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncRefreshKey, setSyncRefreshKey] = useState(0);

  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  

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
        ? { Authorization: `Bearer ${session.access_token}` }
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
        setSavedConn((prev) => ({
          ...conn,
          apiKeyMasked: conn.apiKeyMasked || prev?.apiKeyMasked || "",
          apiKeyConfigured: conn.apiKeyConfigured || prev?.apiKeyConfigured || false,
        }));
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
      // First load failed
    } finally {
      setLoadingConnection(false);
    }
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
      await callYouTube("sync_channels", { connectionId: nextConnectionId, channelId: nextChannelId });
      await callYouTube("sync_videos", { connectionId: nextConnectionId, channelId: nextChannelId, maxResults: 10 });
      const now = new Date().toISOString();
      setLastSync("youtube", now);
      setSavedConn((prev) => prev ? { ...prev, lastSyncAt: now, channelId: nextChannelId } : prev);
      setSyncRefreshKey((k) => k + 1);
      if (!options?.silent) toast.success("YouTube data synced");
      return true;
    } catch (e) {
      if (!options?.silent) toast.error(`Sync failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      return false;
    } finally {
      setSyncing(false);
    }
  }, [callYouTube, channelId, savedConn, setLastSync, settings.connectionId]);

  const handleOAuthCallback = useCallback(async (code: string) => {
    try {
      await callYouTube("oauth_callback", { code, redirectUri: `${window.location.origin}/integrations/youtube` });
      const oauthStatus = await loadConnectionWithRetry();
      if (oauthStatus === "connected" || oauthStatus === "refreshed") {
        toast.success("Google Workspace OAuth connected!");
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

    if (code) sessionStorage.setItem(YOUTUBE_PENDING_OAUTH_CODE_KEY, code);

    if (oauthError) {
      sessionStorage.removeItem(YOUTUBE_PENDING_OAUTH_CODE_KEY);
      url.searchParams.delete("error");
      url.searchParams.delete("error_description");
      url.searchParams.delete("state");
      window.history.replaceState({}, "", url.toString());
      toast.error(`OAuth failed: ${oauthErrorDescription || oauthError}`);
      if (!authLoading && session) loadConnection();
      else setLoadingConnection(false);
      return;
    }

    if (authLoading) return;
    if (!session) { setLoadingConnection(false); return; }

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
    if (loadingConnection || autoSyncAttemptedRef.current || savedConn?.status !== "connected" || !savedConn.channelId || savedConn.lastSyncAt) return;
    autoSyncAttemptedRef.current = true;
    void syncYouTubeData({ connectionId: savedConn.id, channelId: savedConn.channelId, silent: true });
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
      updateSettings("youtube", { connectionId: connection.id, channelId: connection.external_account_id || channelId || "" });
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
        await syncYouTubeData({ connectionId: connection.id, channelId: connection.external_account_id || channelId.trim(), silent: false });
      }
      return true;
    } catch (e) {
      setStatus("youtube", "error");
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
        await syncYouTubeData({ connectionId: connection.id, channelId: connection.external_account_id || channelId.trim(), silent: false });
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
    if (!uploadVideoUrl.trim()) { toast.error("Video URL is required"); return; }
    if (uploadPrivacy === "public") {
      const ok = window.confirm(`Publish "${uploadTitle.trim() || "Untitled"}" PUBLICLY to YouTube? This will be visible to everyone.`);
      if (!ok) return;
    }
    setUploading(true);
    try {
      const tags = tagsInput.split(",").map(t => t.trim()).filter(Boolean).slice(0, 15);
      const hashtags = hashtagsInput.split(/[,\s]+/).map(h => h.replace(/^#/, "").trim()).filter(Boolean);
      const cleanChapters = chapters.filter(c => c.timestamp.trim() && c.title.trim());

      const payload: Record<string, unknown> = {
        title: uploadTitle.trim() || "Untitled",
        description: uploadDescription.trim(),
        privacyStatus: uploadPrivacy,
        videoUrl: uploadVideoUrl.trim(),
        categoryId,
        madeForKids,
        notifySubscribers,
        license,
        embeddable,
        publicStatsViewable,
      };
      if (tags.length) payload.tags = tags;
      if (hashtags.length) payload.hashtags = hashtags;
      if (language) payload.defaultLanguage = language;
      if (defaultAudioLanguage) payload.defaultAudioLanguage = defaultAudioLanguage;
      if (publishAt) payload.publishAt = new Date(publishAt).toISOString();
      if (recordingDate) payload.recordingDate = new Date(recordingDate).toISOString();
      if (locationDescription) payload.locationDescription = locationDescription;
      if (cleanChapters.length) payload.chapters = cleanChapters;
      if (captionsUrl) { payload.captionsUrl = captionsUrl; payload.captionsLanguage = captionsLanguage; }
      if (thumbnailUrl) payload.thumbnailUrl = thumbnailUrl;
      if (playlistId) payload.playlistId = playlistId;
      else if (playlistName.trim()) payload.playlistName = playlistName.trim();
      if (pinnedComment.trim()) payload.pinnedComment = pinnedComment.trim();

      const result = await callYouTube("upload_video", payload);
      const warns = Array.isArray(result?.warnings) && result.warnings.length
        ? ` (${result.warnings.length} warning${result.warnings.length > 1 ? "s" : ""})`
        : "";
      toast.success(`Uploaded! Video ID: ${result.videoId}${warns}`);
      if (Array.isArray(result?.warnings)) {
        result.warnings.forEach((w: string) => toast.warning(w));
      }
      setUploadTitle(""); setUploadDescription(""); setUploadVideoUrl("");
      setTagsInput(""); setHashtagsInput(""); setChapters([]);
      setCaptionsUrl(""); setThumbnailUrl(""); setPlaylistId(""); setPlaylistName("");
      setPinnedComment(""); setPublishAt(""); setRecordingDate(""); setLocationDescription("");
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setUploading(false);
    }
  };

  // Load categories & playlists when the upload panel opens
  useEffect(() => {
    if (!uploadOpen || !oauthConnected) return;
    if (!categoriesList.length) {
      callYouTube("list_video_categories", { regionCode: "US" })
        .then(r => setCategoriesList(((r?.items || []) as Array<{ id: string; snippet: { title: string } }>).map(i => ({ id: i.id, title: i.snippet.title }))))
        .catch(() => {});
    }
    if (!playlistsList.length) {
      callYouTube("list_playlists")
        .then(r => setPlaylistsList(((r?.items || []) as Array<{ id: string; snippet: { title: string } }>).map(i => ({ id: i.id, title: i.snippet.title }))))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadOpen, oauthConnected]);

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
      toast.success("Google Workspace disconnected");
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
        name="Google Workspace"
        description="YouTube, Gmail, Drive, Calendar, Sheets, Docs, Analytics, Search Console — one OAuth."
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
      name="Google Workspace"
      description="YouTube, Gmail, Drive, Calendar, Sheets, Docs, Analytics, Search Console — one OAuth."
      icon={Youtube}
      status={integration.status}
      actions={
        isConnected ? (
          <>
            <button onClick={() => void syncYouTubeData()} disabled={syncing} className={cn(secondaryBtnClass, "disabled:opacity-50 disabled:cursor-not-allowed")}>
              {syncing ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
              Sync Now
            </button>
            <button onClick={handleDisconnect} className="px-4 py-2 rounded-xl text-sm font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
              Disconnect
            </button>
          </>
        ) : undefined
      }
    >
      {/* ── YouTube Data API & Channel (always visible, validated, masked) ── */}
      <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-4">
        <div className="flex items-center gap-2">
          <Youtube className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
          <h3 className="text-sm font-medium text-foreground">YouTube Data API & Channel</h3>
        </div>
        <ApiKeyInput
          label="YouTube Data API Key"
          placeholder="Enter YouTube API key…"
          configured={!!savedConn?.apiKeyConfigured}
          onSave={handleSaveApiKey}
          saving={savingKey}
          maskedHint={savedConn?.apiKeyMasked}
        />
        <ApiKeyInput
          label="Channel ID"
          placeholder="UCxxxxxxxxxxxxxxxxxxxxxx"
          configured={!!savedConn?.channelId}
          onSave={async (value) => {
            const trimmed = value.trim();
            if (!trimmed) { toast.error("Channel ID required"); return false; }
            setChannelId(trimmed);
            setSavingKey(true);
            try {
              const result = await callYouTube("connect", {
                apiKey: "",
                channelId: trimmed,
                accountLabel: accountLabel.trim() || "Primary YouTube",
              });
              const connection = result.connection as { id: string; external_account_id?: string | null };
              updateSettings("youtube", { connectionId: connection.id, channelId: trimmed });
              setSavedConn((prev) => prev ? { ...prev, channelId: trimmed } : prev);
              toast.success("Channel ID saved");
              await syncYouTubeData({ connectionId: connection.id, channelId: trimmed, silent: false });
              return true;
            } catch (e) {
              toast.error(`Save failed: ${e instanceof Error ? e.message : "Unknown error"}`);
              return false;
            } finally {
              setSavingKey(false);
            }
          }}
          saving={savingKey}
          maskedHint={savedConn?.channelId ? `${savedConn.channelId.slice(0, 4)}…${savedConn.channelId.slice(-4)}` : undefined}
        />
        <div>
          <label className="text-[11px] text-muted-foreground">Account label (optional)</label>
          <input
            type="text"
            value={accountLabel}
            onChange={(e) => setAccountLabel(e.target.value)}
            placeholder="Primary YouTube"
            className={cn(inputClass, "mt-1")}
          />
        </div>
      </div>

      {/* ── OAuth Connection ── */}
      <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
          <h3 className="text-sm font-medium text-foreground">Google OAuth Connection</h3>
          {oauthConnected && (
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Active</span>
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <div className={cn("w-2 h-2 rounded-full", oauthConnected ? "bg-primary" : oauthDetail === "refresh_failed" || oauthDetail === "expired_no_refresh" ? "bg-amber-500" : "bg-muted-foreground/40")} />
            <span className="text-muted-foreground">OAuth</span>
            <span className="font-medium text-foreground">
              {oauthConnected ? "Connected" : oauthDetail === "refresh_failed" ? "Expired — re-authorize" : oauthDetail === "expired_no_refresh" ? "Expired" : "Not connected"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={cn("w-2 h-2 rounded-full", isApiKeyConnected ? "bg-primary" : "bg-muted-foreground/40")} />
            <span className="text-muted-foreground">YT Data API</span>
            <span className="font-medium text-foreground">{isApiKeyConnected ? "Connected" : "Not connected"}</span>
          </div>
        </div>
        {savedConn?.lastError && (
          <div className="p-2 rounded-lg bg-destructive/10 text-destructive text-xs flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {savedConn.lastError}
          </div>
        )}
        {oauthConnected ? (
          <div className="flex gap-2 pt-1">
            <button onClick={handleAuthorize} disabled={authorizing} className={secondaryBtnClass}>
              {authorizing ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <Shield className="w-4 h-4 inline mr-1" />}
              Re-authorize
            </button>
            <button
              onClick={async () => {
                try {
                  await callYouTube("oauth_disconnect");
                  setOauthConnected(false);
                  setOauthDetail("disconnected");
                  toast.success("OAuth disconnected");
                } catch (e) {
                  toast.error(`Failed: ${e instanceof Error ? e.message : "Unknown error"}`);
                }
              }}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
            >
              Disconnect OAuth
            </button>
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            <p className="text-xs text-muted-foreground">
              {oauthDetail === "refresh_failed" || oauthDetail === "expired_no_refresh"
                ? "Your OAuth token has expired. Re-authorize to enable all Google services."
                : "Authorize with Google to enable YouTube uploads, Gmail, Drive, Calendar, Sheets, Docs, Analytics, and Search Console."}
            </p>
            <button onClick={handleAuthorize} disabled={authorizing} className={actionBtnClass}>
              {authorizing ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <Shield className="w-4 h-4 inline mr-1" />}
              {oauthDetail === "refresh_failed" || oauthDetail === "expired_no_refresh" ? "Re-authorize Google" : "Authorize Google Workspace"}
            </button>
          </div>
        )}
        <div className="pt-1 border-t border-border/20">
          <p className="text-[10px] text-muted-foreground/60 font-mono select-all break-all">
            Redirect URI: {window.location.origin}/integrations/youtube
          </p>
        </div>
      </div>

      {/* ── Connected APIs Grid ── */}
      <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
        <h3 className="text-sm font-medium text-foreground">Connected Google APIs</h3>
        <p className="text-xs text-muted-foreground">
          {oauthConnected
            ? "All services below share the same OAuth token. Test each to verify the API is enabled in your Google Cloud project."
            : "Connect OAuth above to enable these services."}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {GOOGLE_SERVICES.map((svc) => {
            const test = serviceTests[svc.id];
            const Icon = svc.icon;
            return (
              <button
                key={svc.id}
                disabled={!oauthConnected || test?.status === "testing"}
                onClick={() => testService(svc.id)}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-colors text-center",
                  test?.status === "ok" ? "border-primary/40 bg-primary/5" :
                  test?.status === "error" ? "border-destructive/40 bg-destructive/5" :
                  "border-border/40 bg-card/40 hover:bg-muted/40",
                  !oauthConnected && "opacity-40 cursor-not-allowed",
                )}
              >
                <div className="relative">
                  <Icon className="w-5 h-5 text-foreground" strokeWidth={1.5} />
                  {test?.status === "ok" && <CheckCircle2 className="w-3 h-3 text-primary absolute -top-1 -right-2" />}
                  {test?.status === "error" && <XCircle className="w-3 h-3 text-destructive absolute -top-1 -right-2" />}
                  {test?.status === "testing" && <Loader2 className="w-3 h-3 text-muted-foreground animate-spin absolute -top-1 -right-2" />}
                </div>
                <span className="text-[11px] font-medium text-foreground leading-tight">{svc.name}</span>
                {test?.status === "error" && (
                  <span className="text-[9px] text-destructive leading-tight line-clamp-2">{test.message}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Sync Runs ── */}
      {isApiKeyConnected && savedConn?.id && (
        <SyncRunsList connectionId={savedConn.id} refreshKey={syncRefreshKey} />
      )}


      {oauthConnected && (
        <div className="rounded-2xl border border-border/40 bg-card/60 overflow-hidden">
          <button
            onClick={() => setUploadOpen(!uploadOpen)}
            className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Upload className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} />
              <h3 className="text-sm font-medium text-foreground">Upload Video to YouTube</h3>
            </div>
            {uploadOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {uploadOpen && (
            <div className="px-4 pb-4 space-y-5 border-t border-border/20 pt-3">
              {/* Core */}
              <section className="space-y-2">
                <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Core</h4>
                <input type="text" value={uploadVideoUrl} onChange={(e) => {
                  const raw = e.target.value;
                  const normalized = normalizeVideoUrl(raw);
                  setUploadVideoUrl(normalized);
                  setDriveConverted(normalized !== raw);
                }} placeholder="Public video URL or Google Drive link *" className={inputClass} />
                {driveConverted && (
                  <p className="text-[11px] text-muted-foreground">Google Drive link auto-converted to direct download URL</p>
                )}
                <input type="text" value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="Video title *" className={inputClass} />
                <textarea value={uploadDescription} onChange={(e) => setUploadDescription(e.target.value)} placeholder="Video description" className={cn(inputClass, "min-h-[80px]")} />
                <select value={uploadPrivacy} onChange={(e) => setUploadPrivacy(e.target.value)} className={inputClass}>
                  <option value="private">Private</option>
                  <option value="unlisted">Unlisted</option>
                  <option value="public">Public</option>
                </select>
              </section>

              {/* SEO */}
              <section className="space-y-2">
                <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">SEO & Discovery</h4>
                <input type="text" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="Tags (comma-separated, max 15)" className={inputClass} />
                <input type="text" value={hashtagsInput} onChange={(e) => setHashtagsInput(e.target.value)} placeholder="Hashtags (space or comma separated, max 15)" className={inputClass} />
                <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
                  <option value="22">People & Blogs (default)</option>
                  {categoriesList.filter(c => c.id !== "22").map(c => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Language (e.g. en)" className={inputClass} />
                  <input type="text" value={defaultAudioLanguage} onChange={(e) => setDefaultAudioLanguage(e.target.value)} placeholder="Audio language" className={inputClass} />
                </div>
                <input type="text" value={locationDescription} onChange={(e) => setLocationDescription(e.target.value)} placeholder="Recording location (e.g. Los Angeles, CA)" className={inputClass} />
              </section>

              {/* Schedule & Audience */}
              <section className="space-y-2">
                <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Schedule & Audience</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Publish at</label>
                    <input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Recording date</label>
                    <input type="datetime-local" value={recordingDate} onChange={(e) => setRecordingDate(e.target.value)} className={inputClass} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-xs">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={madeForKids} onChange={(e) => setMadeForKids(e.target.checked)} />
                    <span className="text-foreground">Made for kids (COPPA)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={notifySubscribers} onChange={(e) => setNotifySubscribers(e.target.checked)} />
                    <span className="text-foreground">Notify subscribers</span>
                  </label>
                </div>
              </section>

              {/* Content: chapters + captions */}
              <section className="space-y-2">
                <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Content Structure</h4>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">Chapters (must include 00:00)</span>
                    <button type="button" onClick={() => setChapters([...chapters, { timestamp: "", title: "" }])} className="text-[11px] text-primary hover:underline">+ Add chapter</button>
                  </div>
                  {chapters.map((c, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input type="text" value={c.timestamp} onChange={(e) => {
                        const next = [...chapters]; next[i] = { ...next[i], timestamp: e.target.value }; setChapters(next);
                      }} placeholder="00:00" className={cn(inputClass, "w-24 shrink-0")} />
                      <input type="text" value={c.title} onChange={(e) => {
                        const next = [...chapters]; next[i] = { ...next[i], title: e.target.value }; setChapters(next);
                      }} placeholder="Chapter title" className={inputClass} />
                      <button type="button" onClick={() => setChapters(chapters.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive text-sm shrink-0">×</button>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-[1fr_120px] gap-2">
                  <input type="text" value={captionsUrl} onChange={(e) => setCaptionsUrl(e.target.value)} placeholder="Captions URL (.srt or .vtt)" className={inputClass} />
                  <input type="text" value={captionsLanguage} onChange={(e) => setCaptionsLanguage(e.target.value)} placeholder="Lang" className={inputClass} />
                </div>
              </section>

              {/* Distribution */}
              <section className="space-y-2">
                <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Distribution</h4>
                <select value={playlistId} onChange={(e) => { setPlaylistId(e.target.value); if (e.target.value) setPlaylistName(""); }} className={inputClass}>
                  <option value="">— No playlist —</option>
                  {playlistsList.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
                <input type="text" value={playlistName} onChange={(e) => { setPlaylistName(e.target.value); if (e.target.value) setPlaylistId(""); }} placeholder="…or new playlist name (created if missing)" className={inputClass} />
                <input type="text" value={thumbnailUrl} onChange={(e) => setThumbnailUrl(e.target.value)} placeholder="Custom thumbnail URL (jpg/png)" className={inputClass} />
              </section>

              {/* Engagement */}
              <section className="space-y-2">
                <h4 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Engagement</h4>
                <textarea value={pinnedComment} onChange={(e) => setPinnedComment(e.target.value)} placeholder="Pinned comment (auto-pin attempted; may need manual pin in Studio)" className={cn(inputClass, "min-h-[60px]")} />
              </section>

              {/* Advanced */}
              <section className="space-y-2">
                <button type="button" onClick={() => setAdvancedOpen(!advancedOpen)} className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground">
                  Advanced {advancedOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
                {advancedOpen && (
                  <div className="space-y-2 pl-1">
                    <select value={license} onChange={(e) => setLicense(e.target.value)} className={inputClass}>
                      <option value="youtube">Standard YouTube License</option>
                      <option value="creativeCommon">Creative Commons</option>
                    </select>
                    <div className="flex flex-wrap gap-4 text-xs">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={embeddable} onChange={(e) => setEmbeddable(e.target.checked)} />
                        <span className="text-foreground">Embeddable</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={publicStatsViewable} onChange={(e) => setPublicStatsViewable(e.target.checked)} />
                        <span className="text-foreground">Public stats viewable</span>
                      </label>
                    </div>
                  </div>
                )}
              </section>

              <button onClick={handleUpload} disabled={uploading} className={cn(actionBtnClass, "w-full")}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : <Upload className="w-4 h-4 inline mr-1" />}
                {uploading ? "Uploading…" : "Upload to YouTube"}
              </button>
            </div>
          )}
        </div>
      )}
    </IntegrationDetailLayout>
  );
}
