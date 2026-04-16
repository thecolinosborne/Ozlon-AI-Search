import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YT_BASE = "https://www.googleapis.com/youtube/v3";

type AnyJson = Record<string, unknown>;

function getClients() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  return {
    authClient: createClient(supabaseUrl, anonKey),
    adminClient: createClient(supabaseUrl, serviceKey),
  };
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length);
}

async function getAuthedUserId(req: Request): Promise<string> {
  const token = getBearerToken(req);
  if (!token) throw new Error("Missing bearer token");

  const { authClient } = getClients();
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) throw new Error("Unauthorized");
  return data.user.id;
}

async function ytFetch(path: string, apiKey: string): Promise<AnyJson> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${YT_BASE}${path}${sep}key=${encodeURIComponent(apiKey)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function validateApiKey(apiKey: string): Promise<void> {
  // Use /videos with a known public video ID — costs only 1 quota unit vs 100 for /search
  await ytFetch("/videos?part=snippet&id=dQw4w9WgXcQ&maxResults=1", apiKey);
}

function maskKey(apiKey: string): string {
  const tail = apiKey.slice(-4);
  return `***${tail}`;
}

async function getStoredApiKey(adminClient: any, connectionId: string, userId: string): Promise<string> {
  const { data } = await adminClient
    .from("integration_connections")
    .select("metadata")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .eq("provider", "youtube")
    .single();
  if (!data) throw new Error("Connection not found");
  const meta = data.metadata as AnyJson;
  const key = String(meta?.api_key || "").trim();
  if (!key) throw new Error("No API key stored — please save your API key first");
  return key;
}

// Helper: refresh OAuth token if expired, returns { accessToken, refreshed }
async function refreshOAuthIfNeeded(
  adminClient: any,
  userId: string,
  meta: AnyJson,
): Promise<{ accessToken: string; refreshed: boolean }> {
  const clientId = Deno.env.get("YOUTUBE_CLIENT_ID");
  const clientSecret = Deno.env.get("YOUTUBE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("YouTube OAuth credentials not configured");

  let accessToken = String(meta.access_token || "");
  const refreshToken = String(meta.refresh_token || "");
  const expiresAt = String(meta.expires_at || "");

  if (new Date(expiresAt) > new Date()) {
    return { accessToken, refreshed: false };
  }

  // Token expired — attempt refresh
  if (!refreshToken) throw new Error("No refresh token — re-authorize YouTube");

  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const refreshData = await refreshRes.json();
  if (!refreshRes.ok) throw new Error(`Token refresh failed: ${JSON.stringify(refreshData)}`);

  accessToken = refreshData.access_token;
  const newExpiresAt = new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString();

  await adminClient
    .from("integration_connections")
    .update({
      metadata: {
        ...meta,
        access_token: accessToken,
        expires_at: newExpiresAt,
      },
      last_validated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", "youtube")
    .eq("auth_type", "oauth2");

  return { accessToken, refreshed: true };
}

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const userId = await getAuthedUserId(req);
    const { action, params = {} } = await req.json();
    const { adminClient } = getClients();

    if (!action) throw new Error("Missing action");

    // ── Get Connection — returns BOTH api_key and oauth2 states ──
    if (action === "get_connection") {
      // Fetch api_key connection
      const { data: apiKeyConn } = await adminClient
        .from("integration_connections")
        .select("id, status, external_account_id, external_account_label, metadata, last_sync_at, last_error")
        .eq("user_id", userId)
        .eq("provider", "youtube")
        .eq("auth_type", "api_key")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Fetch oauth2 connection
      const { data: oauthConn } = await adminClient
        .from("integration_connections")
        .select("status, metadata")
        .eq("user_id", userId)
        .eq("provider", "youtube")
        .eq("auth_type", "oauth2")
        .maybeSingle();

      // Build api_key connection response
      let apiKeyResponse = null;
      if (apiKeyConn) {
        const meta = (apiKeyConn.metadata || {}) as AnyJson;
        apiKeyResponse = {
          id: apiKeyConn.id,
          status: apiKeyConn.status,
          channelId: apiKeyConn.external_account_id || "",
          accountLabel: apiKeyConn.external_account_label || "",
          apiKeyMasked: String(meta.api_key_masked || ""),
          apiKeyConfigured: !!meta.api_key,
          lastSyncAt: apiKeyConn.last_sync_at,
          lastError: apiKeyConn.last_error,
        };
      }

      // Build oauth status — attempt token refresh if expired
      let oauthStatus: "connected" | "expired" | "disconnected" = "disconnected";
      if (oauthConn && oauthConn.status === "connected") {
        const oMeta = (oauthConn.metadata || {}) as AnyJson;
        const expiresAt = oMeta.expires_at as string | undefined;
        const hasRefreshToken = !!oMeta.refresh_token;
        const expired = expiresAt ? new Date(expiresAt) < new Date() : true;

        if (!expired) {
          oauthStatus = "connected";
        } else if (hasRefreshToken) {
          // Try to refresh the token
          try {
            await refreshOAuthIfNeeded(adminClient, userId, oMeta);
            oauthStatus = "connected";
          } catch {
            oauthStatus = "expired";
          }
        } else {
          oauthStatus = "expired";
        }
      }

      return jsonOk({
        success: true,
        connection: apiKeyResponse,
        oauthStatus,
      });
    }

    // ── Connect (API key) ──
    if (action === "connect") {
      const apiKey = String((params as AnyJson).apiKey || "").trim();
      const channelId = String((params as AnyJson).channelId || "").trim();
      const accountLabel = String((params as AnyJson).accountLabel || "Primary YouTube").trim();

      // If no API key provided, allow updating channel/label on existing connection
      const { data: existing } = await adminClient
        .from("integration_connections")
        .select("id, metadata")
        .eq("user_id", userId)
        .eq("provider", "youtube")
        .eq("auth_type", "api_key")
        .limit(1)
        .maybeSingle();

      if (!apiKey && existing) {
        // Update channel/label only, keep existing key
        const existingMeta = (existing.metadata || {}) as AnyJson;
        if (!existingMeta.api_key) throw new Error("No existing API key — please provide one");

        const { data: updated, error } = await adminClient
          .from("integration_connections")
          .update({
            external_account_id: channelId || null,
            external_account_label: accountLabel,
          })
          .eq("id", existing.id)
          .select("*")
          .single();
        if (error) throw error;

        return jsonOk({
          success: true,
          connection: updated,
          apiKeyMasked: String(existingMeta.api_key_masked || maskKey(String(existingMeta.api_key))),
        });
      }

      if (!apiKey) throw new Error("apiKey is required");
      await validateApiKey(apiKey);

      let data;
      if (existing) {
        const { data: updated, error } = await adminClient
          .from("integration_connections")
          .update({
            credential_ref: "server_stored_api_key",
            status: "connected",
            external_account_id: channelId || null,
            external_account_label: accountLabel,
            last_validated_at: new Date().toISOString(),
            last_error: null,
            metadata: {
              api_key: apiKey,
              api_key_masked: maskKey(apiKey),
            },
          })
          .eq("id", existing.id)
          .select("*")
          .single();
        if (error) throw error;
        data = updated;
      } else {
        const { data: inserted, error } = await adminClient
          .from("integration_connections")
          .insert({
            user_id: userId,
            provider: "youtube",
            auth_type: "api_key",
            credential_ref: "server_stored_api_key",
            status: "connected",
            external_account_id: channelId || null,
            external_account_label: accountLabel,
            last_validated_at: new Date().toISOString(),
            last_error: null,
            metadata: {
              api_key: apiKey,
              api_key_masked: maskKey(apiKey),
            },
          })
          .select("*")
          .single();
        if (error) throw error;
        data = inserted;
      }

      return jsonOk({
        success: true,
        connection: data,
        apiKeyMasked: maskKey(apiKey),
      });
    }

    if (action === "test_connection") {
      const apiKey = String((params as AnyJson).apiKey || "").trim();
      if (!apiKey) throw new Error("apiKey is required");
      await validateApiKey(apiKey);
      return jsonOk({ success: true });
    }

    if (action === "disconnect") {
      const connectionId = String((params as AnyJson).connectionId || "").trim();
      if (!connectionId) throw new Error("connectionId is required");

      const { error } = await adminClient
        .from("integration_connections")
        .update({ status: "disconnected", last_error: null, metadata: {} })
        .eq("id", connectionId)
        .eq("user_id", userId)
        .eq("provider", "youtube");
      if (error) throw error;

      return jsonOk({ success: true });
    }

    // ── Sync Channels ──
    if (action === "sync_channels") {
      const connectionId = String((params as AnyJson).connectionId || "").trim();
      const channelId = String((params as AnyJson).channelId || "").trim();
      if (!connectionId || !channelId) {
        throw new Error("connectionId and channelId are required");
      }

      let apiKey = String((params as AnyJson).apiKey || "").trim();
      if (!apiKey) apiKey = await getStoredApiKey(adminClient, connectionId, userId);

      const { data: runRow, error: runCreateError } = await adminClient
        .from("integration_sync_runs")
        .insert({
          user_id: userId,
          connection_id: connectionId,
          sync_type: "manual",
          direction: "inbound",
          status: "running",
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (runCreateError) throw runCreateError;

      try {
        const ytChannels = (await ytFetch(
          `/channels?part=snippet,statistics&id=${encodeURIComponent(channelId)}`,
          apiKey,
        )) as { items?: AnyJson[] };
        const items = ytChannels.items || [];

        const channelRows = items.map((item) => {
          const snippet = (item.snippet || {}) as AnyJson;
          const stats = (item.statistics || {}) as AnyJson;
          const thumbs = (snippet.thumbnails || {}) as AnyJson;
          const high = (thumbs.high || {}) as AnyJson;
          return {
            user_id: userId,
            connection_id: connectionId,
            channel_id: String(item.id || channelId),
            title: String(snippet.title || ""),
            description: String(snippet.description || ""),
            thumbnail_url: String(high.url || ""),
            subscriber_count: Number(stats.subscriberCount || 0),
            video_count: Number(stats.videoCount || 0),
            view_count: Number(stats.viewCount || 0),
            raw: item,
            fetched_at: new Date().toISOString(),
          };
        });

        if (channelRows.length > 0) {
          const { error: upsertError } = await adminClient
            .from("youtube_channels")
            .upsert(channelRows, { onConflict: "user_id,channel_id" });
          if (upsertError) throw upsertError;
        }

        await adminClient
          .from("integration_sync_runs")
          .update({
            status: "succeeded",
            completed_at: new Date().toISOString(),
            records_processed: channelRows.length,
          })
          .eq("id", runRow.id);

        await adminClient
          .from("integration_connections")
          .update({ status: "connected", last_sync_at: new Date().toISOString(), last_error: null })
          .eq("id", connectionId)
          .eq("user_id", userId);

        return jsonOk({ success: true, recordsProcessed: channelRows.length });
      } catch (error) {
        await adminClient
          .from("integration_sync_runs")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : "Unknown sync error",
          })
          .eq("id", runRow.id);
        throw error;
      }
    }

    // ── Sync Videos ──
    if (action === "sync_videos") {
      const connectionId = String((params as AnyJson).connectionId || "").trim();
      const channelId = String((params as AnyJson).channelId || "").trim();
      const maxResults = Number((params as AnyJson).maxResults || 10);
      if (!connectionId || !channelId) {
        throw new Error("connectionId and channelId are required");
      }

      let apiKey = String((params as AnyJson).apiKey || "").trim();
      if (!apiKey) apiKey = await getStoredApiKey(adminClient, connectionId, userId);

      const { data: runRow, error: runCreateError } = await adminClient
        .from("integration_sync_runs")
        .insert({
          user_id: userId,
          connection_id: connectionId,
          sync_type: "manual",
          direction: "inbound",
          status: "running",
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (runCreateError) throw runCreateError;

      try {
        const search = (await ytFetch(
          `/search?part=snippet&type=video&order=date&channelId=${encodeURIComponent(channelId)}&maxResults=${Math.min(50, Math.max(1, maxResults))}`,
          apiKey,
        )) as { items?: AnyJson[] };

        const searchItems = search.items || [];
        const ids = searchItems
          .map((item) => ((item.id || {}) as AnyJson).videoId)
          .filter(Boolean)
          .map(String);

        let statsByVideoId = new Map<string, AnyJson>();
        if (ids.length > 0) {
          const details = (await ytFetch(
            `/videos?part=statistics&id=${encodeURIComponent(ids.join(","))}`,
            apiKey,
          )) as { items?: AnyJson[] };
          statsByVideoId = new Map((details.items || []).map((item) => [String(item.id), item]));
        }

        const videoRows = searchItems.map((item) => {
          const idObj = (item.id || {}) as AnyJson;
          const snippet = (item.snippet || {}) as AnyJson;
          const videoId = String(idObj.videoId || "");
          const stats = ((statsByVideoId.get(videoId) || {}) as AnyJson).statistics as AnyJson | undefined;
          const thumbs = (snippet.thumbnails || {}) as AnyJson;
          const high = (thumbs.high || {}) as AnyJson;

          return {
            user_id: userId,
            connection_id: connectionId,
            channel_id: channelId,
            video_id: videoId,
            title: String(snippet.title || ""),
            description: String(snippet.description || ""),
            published_at: snippet.publishedAt ? new Date(String(snippet.publishedAt)).toISOString() : null,
            thumbnail_url: String(high.url || ""),
            view_count: Number(stats?.viewCount || 0),
            like_count: Number(stats?.likeCount || 0),
            comment_count: Number(stats?.commentCount || 0),
            raw: item,
            fetched_at: new Date().toISOString(),
          };
        });

        if (videoRows.length > 0) {
          const { error: upsertError } = await adminClient
            .from("youtube_videos")
            .upsert(videoRows, { onConflict: "user_id,video_id" });
          if (upsertError) throw upsertError;
        }

        await adminClient
          .from("integration_sync_runs")
          .update({
            status: "succeeded",
            completed_at: new Date().toISOString(),
            records_processed: videoRows.length,
          })
          .eq("id", runRow.id);

        await adminClient
          .from("integration_connections")
          .update({ status: "connected", last_sync_at: new Date().toISOString(), last_error: null })
          .eq("id", connectionId)
          .eq("user_id", userId);

        return jsonOk({ success: true, recordsProcessed: videoRows.length });
      } catch (error) {
        await adminClient
          .from("integration_sync_runs")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : "Unknown sync error",
          })
          .eq("id", runRow.id);
        throw error;
      }
    }

    // ── List Sync Runs ──
    if (action === "list_sync_runs") {
      const connectionId = String((params as AnyJson).connectionId || "").trim();
      if (!connectionId) throw new Error("connectionId is required");

      const { data, error } = await adminClient
        .from("integration_sync_runs")
        .select("*")
        .eq("user_id", userId)
        .eq("connection_id", connectionId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;

      return jsonOk({ success: true, runs: data || [] });
    }

    // ── OAuth Authorize ──
    if (action === "oauth_authorize") {
      const clientId = Deno.env.get("YOUTUBE_CLIENT_ID");
      if (!clientId) throw new Error("YOUTUBE_CLIENT_ID not configured");
      const redirectUri = String((params as AnyJson).redirectUri || "").trim();
      if (!redirectUri) throw new Error("redirectUri is required");

      const scopes = [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
      ];
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", scopes.join(" "));
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("state", userId);

      return jsonOk({ success: true, authUrl: authUrl.toString() });
    }

    // ── OAuth Callback ──
    if (action === "oauth_callback") {
      const clientId = Deno.env.get("YOUTUBE_CLIENT_ID");
      const clientSecret = Deno.env.get("YOUTUBE_CLIENT_SECRET");
      if (!clientId || !clientSecret) throw new Error("YouTube OAuth credentials not configured");

      const code = String((params as AnyJson).code || "").trim();
      const redirectUri = String((params as AnyJson).redirectUri || "").trim();
      if (!code) throw new Error("Authorization code is required");
      if (!redirectUri) throw new Error("redirectUri is required");

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);

      const { data: existing } = await adminClient
        .from("integration_connections")
        .select("id")
        .eq("user_id", userId)
        .eq("provider", "youtube")
        .eq("auth_type", "oauth2")
        .limit(1)
        .maybeSingle();

      const oauthMeta = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
        scope: tokenData.scope,
      };

      if (existing) {
        await adminClient
          .from("integration_connections")
          .update({
            status: "connected",
            last_validated_at: new Date().toISOString(),
            last_error: null,
            metadata: oauthMeta,
          })
          .eq("id", existing.id);
      } else {
        const { error } = await adminClient
          .from("integration_connections")
          .insert({
            user_id: userId,
            provider: "youtube",
            auth_type: "oauth2",
            credential_ref: "oauth2_tokens",
            status: "connected",
            last_validated_at: new Date().toISOString(),
            last_error: null,
            metadata: oauthMeta,
          });
        if (error) throw error;
      }

      return jsonOk({ success: true, oauth_connected: true });
    }

    // ── Check OAuth Status (with auto-refresh) ──
    if (action === "oauth_status") {
      const { data } = await adminClient
        .from("integration_connections")
        .select("status, metadata")
        .eq("user_id", userId)
        .eq("provider", "youtube")
        .eq("auth_type", "oauth2")
        .maybeSingle();

      if (!data || data.status !== "connected") {
        return jsonOk({ success: true, oauth_connected: false, oauth_detail: "disconnected" });
      }

      const oMeta = (data.metadata || {}) as AnyJson;
      const expiresAt = oMeta.expires_at as string | undefined;
      const hasRefreshToken = !!oMeta.refresh_token;
      const expired = expiresAt ? new Date(expiresAt) < new Date() : true;

      if (!expired) {
        return jsonOk({ success: true, oauth_connected: true, oauth_detail: "connected" });
      }

      // Token expired — try refresh
      if (hasRefreshToken) {
        try {
          await refreshOAuthIfNeeded(adminClient, userId, oMeta);
          return jsonOk({ success: true, oauth_connected: true, oauth_detail: "refreshed" });
        } catch {
          return jsonOk({ success: true, oauth_connected: false, oauth_detail: "refresh_failed" });
        }
      }

      return jsonOk({ success: true, oauth_connected: false, oauth_detail: "expired_no_refresh" });
    }

    // ── Upload Video ──
    if (action === "upload_video") {
      const clientId = Deno.env.get("YOUTUBE_CLIENT_ID");
      const clientSecret = Deno.env.get("YOUTUBE_CLIENT_SECRET");
      if (!clientId || !clientSecret) throw new Error("YouTube OAuth credentials not configured");

      const { data: conn } = await adminClient
        .from("integration_connections")
        .select("metadata")
        .eq("user_id", userId)
        .eq("provider", "youtube")
        .eq("auth_type", "oauth2")
        .single();
      if (!conn) throw new Error("YouTube OAuth not connected. Please authorize first.");

      const meta = conn.metadata as AnyJson;
      const { accessToken } = await refreshOAuthIfNeeded(adminClient, userId, meta);

      const title = String((params as AnyJson).title || "Untitled");
      const description = String((params as AnyJson).description || "");
      const privacyStatus = String((params as AnyJson).privacyStatus || "private");
      let videoUrl = String((params as AnyJson).videoUrl || "").trim();

      if (!videoUrl) throw new Error("videoUrl is required (public URL to video file)");

      // Auto-convert Google Drive share links to direct download URLs
      const driveFileMatch = videoUrl.match(/drive\.google\.com\/file\/d\/([^\/]+)/);
      const driveOpenMatch = !driveFileMatch && videoUrl.match(/drive\.google\.com\/open\?id=([^&]+)/);
      const driveId = driveFileMatch?.[1] || driveOpenMatch?.[1];
      if (driveId) {
        videoUrl = `https://drive.google.com/uc?export=download&confirm=t&id=${driveId}`;
      }

      const videoRes = await fetch(videoUrl, { redirect: "follow" });
      if (!videoRes.ok) throw new Error(`Failed to download video: ${videoRes.status}`);

      // Validate content type — reject HTML responses
      const rawContentType = videoRes.headers.get("content-type") || "";
      if (rawContentType.includes("text/html")) {
        throw new Error("The URL returned an HTML page instead of a video file. Please provide a direct download link to the video.");
      }

      // Infer correct MIME type
      const mimeMap: Record<string, string> = {
        mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
        avi: "video/x-msvideo", mkv: "video/x-matroska", m4v: "video/mp4",
      };
      const ext = videoUrl.split("?")[0].split(".").pop()?.toLowerCase() || "";
      const detectedMime = rawContentType.split(";")[0].trim();
      const videoMime = (detectedMime && detectedMime !== "application/octet-stream")
        ? detectedMime
        : (mimeMap[ext] || "video/mp4");

      const videoBlob = await videoRes.blob();

      const initiateRes = await fetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Upload-Content-Length": String(videoBlob.size),
            "X-Upload-Content-Type": videoMime,
          },
          body: JSON.stringify({
            snippet: { title, description },
            status: { privacyStatus },
          }),
        },
      );
      if (!initiateRes.ok) {
        const errBody = await initiateRes.text();
        throw new Error(`Upload initiation failed: ${initiateRes.status} ${errBody}`);
      }
      const uploadUrl = initiateRes.headers.get("Location");
      if (!uploadUrl) throw new Error("No upload URL returned");

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": videoMime,
          "Content-Length": String(videoBlob.size),
        },
        body: videoBlob,
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(`Upload failed: ${JSON.stringify(uploadData)}`);

      return jsonOk({
        success: true,
        videoId: uploadData.id,
        url: `https://www.youtube.com/watch?v=${uploadData.id}`,
      });
    }

    throw new Error(`Unsupported action: ${action}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
