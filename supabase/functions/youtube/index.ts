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

  // Service-role bypass: trusted internal callers (e.g. chat function, post-upload self-call) can pass x-user-id
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (token === serviceKey) {
    const xUid = req.headers.get("x-user-id");
    if (!xUid) throw new Error("Service-role caller must provide x-user-id header");
    return xUid;
  }

  const { authClient } = getClients();
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) throw new Error("Unauthorized");
  return data.user.id;
}

async function ytFetch(path: string, apiKey: string): Promise<AnyJson> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${YT_BASE}${path}${sep}key=${encodeURIComponent(apiKey)}`);
  const data = await res.json();
  if (!res.ok) {
    // Surface Google's specific error reason instead of dumping the raw payload.
    const err = ((data as AnyJson)?.error || {}) as AnyJson;
    const reason = (err?.errors as AnyJson[] | undefined)?.[0]?.reason || err?.status;
    const message = err?.message || "Unknown error";
    let hint = "";
    if (reason === "API_KEY_INVALID" || res.status === 400) {
      hint = "Your YouTube Data API key looks invalid. Double-check the value in Google Cloud Console → Credentials.";
    } else if (reason === "SERVICE_DISABLED" || reason === "accessNotConfigured") {
      hint = "YouTube Data API v3 is not enabled in this key's Google Cloud project. Enable it under APIs & Services → Library.";
    } else if (reason === "ipRefererBlocked" || reason === "referrerNotPermitted") {
      hint = "This API key is restricted to a referrer/IP that doesn't include this server. Edit the key's restrictions in Google Cloud Console.";
    } else if (reason === "quotaExceeded" || reason === "rateLimitExceeded") {
      hint = "YouTube Data API quota exceeded for this key.";
    }
    throw new Error(hint ? `${hint} (${reason || res.status}: ${message})` : `YouTube API ${res.status}: ${message}${reason ? ` [${reason}]` : ""}`);
  }
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

async function tryVaultRead(
  adminClient: any,
  connectionId: string,
  userId: string,
): Promise<string | null> {
  try {
    const vaultKey = Deno.env.get("VAULT_ENCRYPTION_KEY");
    if (!vaultKey) return null;
    const keyBytes = new TextEncoder().encode(vaultKey);
    if (keyBytes.length !== 32) {
      console.warn(`[youtube/vault] VAULT_ENCRYPTION_KEY wrong length: ${keyBytes.length}`);
      return null;
    }
    const hexKey = "\\x" + Array.from(keyBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data, error } = await adminClient.rpc("get_user_secret", {
      _connection_id: connectionId,
      _user_id: userId,
      _secret_name: "api_key",
      _encryption_key: hexKey,
    });
    if (error) {
      console.warn("[youtube/vault] get_user_secret error:", error.message);
      return null;
    }
    const plain = typeof data === "string" ? data.trim() : null;
    if (plain && plain.length > 0) {
      // Best-effort audit log
      adminClient
        .from("credential_audit_log")
        .insert({
          user_id: userId,
          connection_id: connectionId,
          provider: "youtube",
          action: "vault_read",
          detail: "api_key",
        })
        .then(() => {})
        .catch(() => {});
      return plain;
    }
    return null;
  } catch (e) {
    console.warn("[youtube/vault] threw:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function getStoredApiKey(adminClient: any, connectionId: string, userId: string): Promise<string> {
  // 1. Vault-first
  const vaultKey = await tryVaultRead(adminClient, connectionId, userId);
  if (vaultKey) return vaultKey;

  // 2. Fallback: legacy metadata.api_key
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

    // ── Get Connection — single row holds BOTH api_key and oauth2 state ──
    if (action === "get_connection") {
      const { data: conn } = await adminClient
        .from("integration_connections")
        .select("id, status, auth_type, external_account_id, external_account_label, metadata, last_sync_at, last_error")
        .eq("user_id", userId)
        .eq("provider", "youtube")
        .maybeSingle();

      let apiKeyResponse = null;
      let oauthStatus: "connected" | "expired" | "disconnected" = "disconnected";

      if (conn) {
        const meta = (conn.metadata || {}) as AnyJson;

        // Derive API key state from metadata.api_key (regardless of auth_type)
        if (meta.api_key) {
          apiKeyResponse = {
            id: conn.id,
            status: "connected",
            channelId: conn.external_account_id || "",
            accountLabel: conn.external_account_label || "",
            apiKeyMasked: String(meta.api_key_masked || ""),
            apiKeyConfigured: true,
            lastSyncAt: conn.last_sync_at,
            lastError: conn.last_error,
          };
        }

        // Derive OAuth state from metadata tokens (regardless of auth_type)
        const hasAccessToken = !!meta.access_token;
        const hasRefreshToken = !!meta.refresh_token;
        const expiresAt = meta.expires_at as string | undefined;
        const expired = expiresAt ? new Date(expiresAt) < new Date() : true;

        if (hasAccessToken && !expired) {
          oauthStatus = "connected";
        } else if (hasRefreshToken) {
          try {
            await refreshOAuthIfNeeded(adminClient, userId, meta);
            oauthStatus = "connected";
          } catch {
            oauthStatus = "expired";
          }
        } else if (hasAccessToken) {
          oauthStatus = "expired";
        }
      }

      const grantedScopes = conn ? String(((conn.metadata || {}) as AnyJson).scope || "") : "";

      // Surface the synced YouTube channel identity so the UI can confirm which channel is connected
      let channelInfo: AnyJson | null = null;
      if (conn?.external_account_id) {
        const { data: ch } = await adminClient
          .from("youtube_channels")
          .select("channel_id, title, thumbnail_url, subscriber_count, video_count, view_count, fetched_at")
          .eq("user_id", userId)
          .eq("channel_id", conn.external_account_id)
          .maybeSingle();
        if (ch) channelInfo = ch as AnyJson;
      }

      return jsonOk({
        success: true,
        connection: apiKeyResponse,
        oauthStatus,
        grantedScopes,
        channelInfo,
      });
    }

    // ── Connect (API key) ──
    if (action === "connect") {
      const apiKey = String((params as AnyJson).apiKey || "").trim();
      const channelIdRaw = (params as AnyJson).channelId;
      const channelId = channelIdRaw == null ? "" : String(channelIdRaw).trim();
      const accountLabel = String((params as AnyJson).accountLabel || "Primary YouTube").trim();

      console.log("[youtube/connect] start", {
        userId,
        hasApiKey: !!apiKey,
        apiKeyLen: apiKey.length,
        apiKeyPrefix: apiKey.slice(0, 4),
        apiKeySuffix: apiKey.slice(-4),
        channelId: channelId || null,
      });

      // Find existing youtube connection (any auth_type — unique constraint is on (user_id, provider))
      const { data: existing, error: existingErr } = await adminClient
        .from("integration_connections")
        .select("id, metadata, external_account_id, external_account_label, auth_type, status")
        .eq("user_id", userId)
        .eq("provider", "youtube")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingErr) {
        console.error("[youtube/connect] existing lookup failed:", existingErr);
        throw new Error(`Failed to load existing connection: ${existingErr.message}`);
      }

      // Must provide at least one of apiKey or channelId
      if (!apiKey && !channelId) {
        throw new Error("Provide an API key or Channel ID to save");
      }

      // Validate apiKey ONLY if provided
      if (apiKey) {
        try {
          await validateApiKey(apiKey);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[youtube/connect] validateApiKey failed:", msg);
          throw new Error(msg);
        }
      }

      // Resolve a key to use for channel-ID validation (new key OR stored)
      let keyForChannelValidation = apiKey;
      if (!keyForChannelValidation && channelId && existing) {
        try {
          keyForChannelValidation = await getStoredApiKey(adminClient, existing.id, userId);
        } catch (e) {
          console.warn("[youtube/connect] getStoredApiKey failed:", e instanceof Error ? e.message : e);
        }
      }

      // If a channelId was supplied, validate it (requires a key)
      let resolvedChannelLabel = accountLabel;
      if (channelId) {
        if (!keyForChannelValidation) {
          throw new Error("Cannot validate Channel ID — save your YouTube Data API key first");
        }
        try {
          const ch = (await ytFetch(
            `/channels?part=snippet&id=${encodeURIComponent(channelId)}`,
            keyForChannelValidation,
          )) as { items?: AnyJson[] };
          if (!ch.items || ch.items.length === 0) {
            throw new Error(`Channel ID "${channelId}" not found on YouTube`);
          }
          const snippet = (ch.items[0].snippet || {}) as AnyJson;
          if (snippet.title) resolvedChannelLabel = String(snippet.title);
        } catch (e) {
          throw new Error(
            `Channel validation failed: ${e instanceof Error ? e.message : "unknown"}`,
          );
        }
      }

      // Build incremental metadata patch — merge into existing to preserve OAuth tokens + other keys
      const existingMeta = (existing?.metadata || {}) as AnyJson;
      const metaPatch: AnyJson = {};
      if (apiKey) {
        metaPatch.api_key = apiKey;
        metaPatch.api_key_masked = maskKey(apiKey);
      }
      const newMeta: AnyJson = { ...existingMeta, ...metaPatch };

      let data;
      if (existing) {
        const updatePayload: AnyJson = {
          status: "connected",
          last_validated_at: new Date().toISOString(),
          last_error: null,
          metadata: newMeta,
        };
        // Always write external_account_id when channelId provided; otherwise preserve existing
        if (channelId) {
          updatePayload.external_account_id = channelId;
          updatePayload.external_account_label = resolvedChannelLabel || existing.external_account_label || "Primary YouTube";
        } else if (!existing.external_account_label && accountLabel) {
          updatePayload.external_account_label = accountLabel;
        }
        // Only set credential_ref if the row doesn't already track OAuth tokens
        if (existing.auth_type !== "oauth" && existing.auth_type !== "oauth2") {
          updatePayload.credential_ref = "server_stored_api_key";
        }
        const { data: updated, error } = await adminClient
          .from("integration_connections")
          .update(updatePayload)
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
            external_account_label: resolvedChannelLabel,
            last_validated_at: new Date().toISOString(),
            last_error: null,
            metadata: newMeta,
          })
          .select("*")
          .single();
        if (error) throw error;
        data = inserted;
      }

      // Dual-write: mirror api_key into encrypted vault ONLY when a new key was provided
      if (apiKey) {
        try {
          const vaultKey = Deno.env.get("VAULT_ENCRYPTION_KEY");
          if (vaultKey) {
            const keyBytes = new TextEncoder().encode(vaultKey);
            if (keyBytes.length === 32) {
              const hexKey = "\\x" + Array.from(keyBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
              const { error: rpcErr } = await adminClient.rpc("store_user_secret", {
                _connection_id: data.id,
                _user_id: userId,
                _plaintext: apiKey,
                _encryption_key: hexKey,
                _secret_name: "api_key",
              });
              if (rpcErr) {
                console.warn("[youtube/connect] vault store_user_secret failed:", rpcErr.message);
              } else {
                await adminClient.from("credential_audit_log").insert({
                  user_id: userId,
                  connection_id: data.id,
                  provider: "youtube",
                  action: "vault_store",
                  detail: "api_key",
                });
              }
            } else {
              console.warn(`[youtube/connect] VAULT_ENCRYPTION_KEY wrong length: ${keyBytes.length}`);
            }
          } else {
            console.warn("[youtube/connect] VAULT_ENCRYPTION_KEY not set, skipping vault mirror");
          }
        } catch (e) {
          console.warn("[youtube/connect] vault mirror threw:", e instanceof Error ? e.message : e);
        }
      }

      // ── Auto-sync channel details immediately so the "Connected channel" card populates ──
      // Best-effort: failure here doesn't block the save response.
      const finalChannelId = String(data?.external_account_id || "");
      const keyForAutoSync = apiKey || keyForChannelValidation || "";
      if (finalChannelId && keyForAutoSync) {
        try {
          const ytCh = (await ytFetch(
            `/channels?part=snippet,statistics&id=${encodeURIComponent(finalChannelId)}`,
            keyForAutoSync,
          )) as { items?: AnyJson[] };
          const items = ytCh.items || [];
          if (items.length > 0) {
            const item = items[0];
            const snippet = (item.snippet || {}) as AnyJson;
            const stats = (item.statistics || {}) as AnyJson;
            const thumbs = (snippet.thumbnails || {}) as AnyJson;
            const high = (thumbs.high || thumbs.medium || thumbs.default || {}) as AnyJson;
            const row = {
              user_id: userId,
              connection_id: data.id,
              channel_id: String(item.id || finalChannelId),
              title: String(snippet.title || ""),
              description: String(snippet.description || ""),
              thumbnail_url: String(high.url || ""),
              subscriber_count: Number(stats.subscriberCount || 0),
              video_count: Number(stats.videoCount || 0),
              view_count: Number(stats.viewCount || 0),
              raw: item,
              fetched_at: new Date().toISOString(),
            };
            const { error: upErr } = await adminClient
              .from("youtube_channels")
              .upsert(row, { onConflict: "user_id,channel_id" });
            if (upErr) {
              console.warn("[youtube/connect] auto-sync upsert failed:", upErr.message);
            } else {
              await adminClient
                .from("integration_connections")
                .update({ last_sync_at: new Date().toISOString(), last_error: null })
                .eq("id", data.id);
            }
          } else {
            console.warn("[youtube/connect] auto-sync: channel returned no items");
          }
        } catch (e) {
          console.warn("[youtube/connect] auto-sync threw:", e instanceof Error ? e.message : e);
        }
      }

      const finalMaskedKey = String(((data?.metadata || {}) as AnyJson).api_key_masked || "");
      return jsonOk({
        success: true,
        connection: data,
        apiKeyMasked: finalMaskedKey,
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

      // Also clear OAuth connection if it exists
      await adminClient
        .from("integration_connections")
        .update({ status: "disconnected", last_error: null, metadata: {} })
        .eq("user_id", userId)
        .eq("provider", "youtube")
        .eq("auth_type", "oauth2");

      return jsonOk({ success: true });
    }

    // ── OAuth Disconnect — clears OAuth tokens only, keeps API key ──
    if (action === "oauth_disconnect") {
      const { data: oauthConn } = await adminClient
        .from("integration_connections")
        .select("id, metadata")
        .eq("user_id", userId)
        .eq("provider", "youtube")
        .eq("auth_type", "oauth2")
        .maybeSingle();

      if (oauthConn) {
        await adminClient
          .from("integration_connections")
          .update({ status: "disconnected", metadata: {}, last_error: null })
          .eq("id", oauthConn.id);
      }

      return jsonOk({ success: true, oauthStatus: "disconnected" });
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
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.labels",
        "https://www.googleapis.com/auth/gmail.settings.basic",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/presentations",
        "https://www.googleapis.com/auth/webmasters.readonly",
        "https://www.googleapis.com/auth/analytics.readonly",
        "https://www.googleapis.com/auth/tagmanager.readonly",
        "https://www.googleapis.com/auth/tagmanager.edit.containers",
        "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
        "https://www.googleapis.com/auth/tagmanager.publish",
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

    // ── Helper: get OAuth access token (used by upload + sub-actions) ──
    const getOAuthToken = async (): Promise<string> => {
      const { data: conn } = await adminClient
        .from("integration_connections")
        .select("metadata")
        .eq("user_id", userId)
        .eq("provider", "youtube")
        .eq("auth_type", "oauth2")
        .single();
      if (!conn) throw new Error("YouTube OAuth not connected. Please authorize first.");
      const m = conn.metadata as AnyJson;
      const { accessToken: t } = await refreshOAuthIfNeeded(adminClient, userId, m);
      return t;
    };

    // ── Helper: download a remote file (Drive-aware) ──
    const downloadFile = async (url: string, accessToken: string): Promise<Response> => {
      const driveFileMatch = url.match(/drive\.google\.com\/file\/d\/([^\/]+)/) || null;
      const driveOpenMatch = !driveFileMatch ? (url.match(/drive\.google\.com\/open\?id=([^&]+)/) || null) : null;
      const driveUcMatch = !driveFileMatch && !driveOpenMatch ? (url.match(/drive\.google\.com\/uc\?.*id=([^&]+)/) || null) : null;
      const driveId = driveFileMatch?.[1] || driveOpenMatch?.[1] || driveUcMatch?.[1];
      if (driveId) {
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          redirect: "follow",
        });
        if (!r.ok) {
          const errBody = await r.text().catch(() => "");
          throw new Error(`Drive download failed (${r.status}): ${errBody.slice(0, 200)}`);
        }
        return r;
      }
      const r = await fetch(url, { redirect: "follow" });
      if (!r.ok) throw new Error(`Download failed: ${r.status}`);
      return r;
    };

    // ── set_thumbnail ──
    if (action === "set_thumbnail") {
      const accessToken = await getOAuthToken();
      const videoId = String((params as AnyJson).videoId || "");
      const thumbnailUrl = String((params as AnyJson).thumbnailUrl || "");
      if (!videoId || !thumbnailUrl) throw new Error("videoId and thumbnailUrl are required");
      const tRes = await downloadFile(thumbnailUrl, accessToken);
      const ct = (tRes.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
      const buf = await tRes.arrayBuffer();
      const r = await fetch(
        `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": ct },
          body: buf,
        },
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Thumbnail set failed: ${r.status} ${JSON.stringify(data)}`);
      return jsonOk({ success: true, data });
    }

    // ── upload_caption ──
    if (action === "upload_caption") {
      const accessToken = await getOAuthToken();
      const videoId = String((params as AnyJson).videoId || "");
      const captionsUrl = String((params as AnyJson).captionsUrl || "");
      const language = String((params as AnyJson).language || "en");
      const name = String((params as AnyJson).name || "Captions");
      const isDraft = Boolean((params as AnyJson).isDraft);
      if (!videoId || !captionsUrl) throw new Error("videoId and captionsUrl are required");

      const cRes = await downloadFile(captionsUrl, accessToken);
      const captionBuf = await cRes.arrayBuffer();

      // Multipart-related: metadata JSON + binary file body
      const boundary = `----ozlon${Date.now()}`;
      const meta = {
        snippet: { videoId, language, name, isDraft },
      };
      const enc = new TextEncoder();
      const head = enc.encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      );
      const tail = enc.encode(`\r\n--${boundary}--\r\n`);
      const body = new Uint8Array(head.length + captionBuf.byteLength + tail.length);
      body.set(head, 0);
      body.set(new Uint8Array(captionBuf), head.length);
      body.set(tail, head.length + captionBuf.byteLength);

      const r = await fetch(
        "https://www.googleapis.com/upload/youtube/v3/captions?part=snippet&uploadType=multipart",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body,
        },
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Caption upload failed: ${r.status} ${JSON.stringify(data)}`);
      return jsonOk({ success: true, data });
    }

    // ── list_playlists ──
    if (action === "list_playlists") {
      const accessToken = await getOAuthToken();
      const r = await fetch(
        "https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&mine=true&maxResults=50",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(`List playlists failed: ${r.status} ${JSON.stringify(data)}`);
      return jsonOk({ success: true, items: data.items || [] });
    }

    // ── list_video_categories ──
    if (action === "list_video_categories") {
      const accessToken = await getOAuthToken();
      const regionCode = String((params as AnyJson).regionCode || "US");
      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=${encodeURIComponent(regionCode)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(`List categories failed: ${r.status} ${JSON.stringify(data)}`);
      const items = (data.items || []).filter((c: AnyJson) => (c.snippet as AnyJson)?.assignable);
      return jsonOk({ success: true, items });
    }

    // ── add_to_playlist (supports name → id, creates if missing) ──
    if (action === "add_to_playlist") {
      const accessToken = await getOAuthToken();
      const videoId = String((params as AnyJson).videoId || "");
      let playlistId = String((params as AnyJson).playlistId || "");
      const playlistName = String((params as AnyJson).playlistName || "").trim();
      if (!videoId) throw new Error("videoId is required");
      if (!playlistId && !playlistName) throw new Error("playlistId or playlistName required");

      if (!playlistId && playlistName) {
        const lr = await fetch(
          "https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50",
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const ld = await lr.json();
        if (lr.ok) {
          const found = (ld.items || []).find(
            (p: AnyJson) => String((p.snippet as AnyJson)?.title || "").toLowerCase() === playlistName.toLowerCase(),
          );
          if (found) playlistId = (found as AnyJson).id as string;
        }
        if (!playlistId) {
          const cr = await fetch(
            "https://www.googleapis.com/youtube/v3/playlists?part=snippet,status",
            {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                snippet: { title: playlistName },
                status: { privacyStatus: "private" },
              }),
            },
          );
          const cd = await cr.json();
          if (!cr.ok) throw new Error(`Playlist create failed: ${cr.status} ${JSON.stringify(cd)}`);
          playlistId = cd.id;
        }
      }

      const r = await fetch(
        "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            snippet: {
              playlistId,
              resourceId: { kind: "youtube#video", videoId },
            },
          }),
        },
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Add to playlist failed: ${r.status} ${JSON.stringify(data)}`);
      return jsonOk({ success: true, playlistId, data });
    }

    // ── pin_comment ──
    if (action === "pin_comment") {
      const accessToken = await getOAuthToken();
      const videoId = String((params as AnyJson).videoId || "");
      const commentText = String((params as AnyJson).commentText || "");
      if (!videoId || !commentText) throw new Error("videoId and commentText are required");

      const ir = await fetch(
        "https://www.googleapis.com/youtube/v3/commentThreads?part=snippet",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            snippet: {
              videoId,
              topLevelComment: { snippet: { textOriginal: commentText } },
            },
          }),
        },
      );
      const idata = await ir.json();
      if (!ir.ok) throw new Error(`Comment insert failed: ${ir.status} ${JSON.stringify(idata)}`);

      const commentId = idata?.snippet?.topLevelComment?.id;
      if (commentId) {
        // Best-effort pin via comments.setModerationStatus (requires force pin)
        const pr = await fetch(
          `https://www.googleapis.com/youtube/v3/comments/setModerationStatus?id=${encodeURIComponent(commentId)}&moderationStatus=published&banAuthor=false`,
          { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!pr.ok) {
          // pinning is often manual-only via UI; surface a warning rather than failing
          return jsonOk({ success: true, commentId, warning: "Comment posted but auto-pin not supported by API; pin manually in Studio if needed." });
        }
      }
      return jsonOk({ success: true, commentId });
    }

    // ── update_video (metadata-only PUT) ──
    if (action === "update_video") {
      const accessToken = await getOAuthToken();
      const videoId = String((params as AnyJson).videoId || "");
      if (!videoId) throw new Error("videoId is required");
      const p = params as AnyJson;
      const snippet: AnyJson = { categoryId: String(p.categoryId || "22") };
      if (p.title !== undefined) snippet.title = String(p.title);
      if (p.description !== undefined) snippet.description = String(p.description);
      if (p.tags !== undefined) snippet.tags = Array.isArray(p.tags) ? p.tags : [];
      if (p.defaultLanguage) snippet.defaultLanguage = String(p.defaultLanguage);
      if (p.defaultAudioLanguage) snippet.defaultAudioLanguage = String(p.defaultAudioLanguage);
      const status: AnyJson = {};
      if (p.privacyStatus) status.privacyStatus = String(p.privacyStatus);
      if (p.license) status.license = String(p.license);
      if (p.embeddable !== undefined) status.embeddable = Boolean(p.embeddable);
      if (p.publicStatsViewable !== undefined) status.publicStatsViewable = Boolean(p.publicStatsViewable);
      if (p.madeForKids !== undefined) status.selfDeclaredMadeForKids = Boolean(p.madeForKids);
      if (p.publishAt) { status.publishAt = String(p.publishAt); status.privacyStatus = "private"; }

      const parts = ["snippet"];
      if (Object.keys(status).length) parts.push("status");
      const r = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=${parts.join(",")}`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ id: videoId, snippet, ...(Object.keys(status).length ? { status } : {}) }),
        },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(`Update failed: ${r.status} ${JSON.stringify(data)}`);
      return jsonOk({ success: true, data });
    }

    // ── Upload Video (expanded) ──
    if (action === "upload_video") {
      const accessToken = await getOAuthToken();
      const p = params as AnyJson;

      const title = String(p.title || "Untitled");
      let description = String(p.description || "");
      const privacyStatus = String(p.privacyStatus || "private");
      const videoUrl = String(p.videoUrl || "").trim();
      if (!videoUrl) throw new Error("videoUrl is required (public URL to video file)");

      // Build snippet
      const tags: string[] = Array.isArray(p.tags) ? (p.tags as string[]).filter(Boolean).slice(0, 15) : [];
      const categoryId = String(p.categoryId || "22");
      const defaultLanguage = p.defaultLanguage ? String(p.defaultLanguage) : undefined;
      const defaultAudioLanguage = p.defaultAudioLanguage ? String(p.defaultAudioLanguage) : undefined;

      // Append chapters into description (must include 00:00 to be valid YT chapters)
      const chapters = Array.isArray(p.chapters) ? p.chapters as Array<{ timestamp?: string; title?: string }> : [];
      if (chapters.length) {
        const hasZero = chapters.some(c => (c.timestamp || "").trim() === "00:00" || (c.timestamp || "").trim() === "0:00");
        const formatted = chapters
          .filter(c => c.timestamp && c.title)
          .map(c => `${c.timestamp} ${c.title}`)
          .join("\n");
        if (formatted) {
          description = `${description}\n\n${hasZero ? "" : "00:00 Intro\n"}${formatted}`.trim();
        }
      }

      // Append hashtags (deduped, max 15)
      const hashtags: string[] = Array.isArray(p.hashtags) ? (p.hashtags as string[]).filter(Boolean) : [];
      if (hashtags.length) {
        const seen = new Set<string>();
        const tagLine = hashtags
          .map(h => (h.startsWith("#") ? h : `#${h}`))
          .filter(h => { const k = h.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
          .slice(0, 15)
          .join(" ");
        description = `${description}\n\n${tagLine}`.trim();
      }

      // Build status
      const status: AnyJson = { privacyStatus };
      if (p.license) status.license = String(p.license);
      if (p.embeddable !== undefined) status.embeddable = Boolean(p.embeddable);
      if (p.publicStatsViewable !== undefined) status.publicStatsViewable = Boolean(p.publicStatsViewable);
      const madeForKids = p.madeForKids !== undefined ? Boolean(p.madeForKids) : (p.selfDeclaredMadeForKids !== undefined ? Boolean(p.selfDeclaredMadeForKids) : undefined);
      if (madeForKids !== undefined) status.selfDeclaredMadeForKids = madeForKids;
      if (p.publishAt) {
        status.publishAt = String(p.publishAt);
        status.privacyStatus = "private"; // required by YT when scheduling
      }

      // recordingDetails
      const recordingDetails: AnyJson = {};
      if (p.recordingDate) recordingDetails.recordingDate = String(p.recordingDate);
      if (p.locationDescription) recordingDetails.locationDescription = String(p.locationDescription);

      const snippet: AnyJson = { title, description, categoryId };
      if (tags.length) snippet.tags = tags;
      if (defaultLanguage) snippet.defaultLanguage = defaultLanguage;
      if (defaultAudioLanguage) snippet.defaultAudioLanguage = defaultAudioLanguage;

      const resourceBody: AnyJson = { snippet, status };
      if (Object.keys(recordingDetails).length) resourceBody.recordingDetails = recordingDetails;

      // Download video (streaming)
      const videoRes = await downloadFile(videoUrl, accessToken);
      const rawContentType = videoRes.headers.get("content-type") || "";
      if (rawContentType.includes("text/html")) {
        throw new Error("The URL returned an HTML page instead of a video file. Please provide a direct download link.");
      }
      const mimeMap: Record<string, string> = {
        mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
        avi: "video/x-msvideo", mkv: "video/x-matroska", m4v: "video/mp4",
      };
      const ext = videoUrl.split("?")[0].split(".").pop()?.toLowerCase() || "";
      const detectedMime = rawContentType.split(";")[0].trim();
      const videoMime = (detectedMime && detectedMime !== "application/octet-stream")
        ? detectedMime : (mimeMap[ext] || "video/mp4");

      const contentLengthHeader = videoRes.headers.get("content-length");
      const contentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
      if (!contentLength || Number.isNaN(contentLength)) {
        throw new Error("Source did not return a Content-Length header. Use a direct download URL (e.g. Google Drive file ID) that reports size.");
      }

      // Initiate resumable session
      const partsList = ["snippet", "status"];
      if (Object.keys(recordingDetails).length) partsList.push("recordingDetails");
      const notify = p.notifySubscribers !== undefined ? Boolean(p.notifySubscribers) : true;
      const initiateRes = await fetch(
        `https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=${partsList.join(",")}&notifySubscribers=${notify}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Upload-Content-Length": String(contentLength),
            "X-Upload-Content-Type": videoMime,
          },
          body: JSON.stringify(resourceBody),
        },
      );
      if (!initiateRes.ok) {
        const errBody = await initiateRes.text();
        throw new Error(`Upload initiation failed: ${initiateRes.status} ${errBody}`);
      }
      const uploadUrl = initiateRes.headers.get("Location");
      if (!uploadUrl) throw new Error("No upload URL returned");
      if (!videoRes.body) throw new Error("Source response has no readable body to stream");

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": videoMime, "Content-Length": String(contentLength) },
        body: videoRes.body,
        // @ts-ignore — Deno fetch supports duplex
        duplex: "half",
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status} ${JSON.stringify(uploadData)}`);

      const videoId = uploadData.id as string;
      const warnings: string[] = [];

      // ── Post-upload chain (best-effort) ──
      const callSelf = async (sub: string, payload: AnyJson) => {
        try {
          const fwdHeaders: Record<string, string> = {
            Authorization: req.headers.get("Authorization") || "",
            "Content-Type": "application/json",
          };
          const xUid = req.headers.get("x-user-id");
          if (xUid) fwdHeaders["x-user-id"] = xUid;
          const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/youtube`, {
            method: "POST",
            headers: fwdHeaders,
            body: JSON.stringify({ action: sub, ...payload }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || d?.error) warnings.push(`${sub}: ${d?.error || r.status}`);
        } catch (e) {
          warnings.push(`${sub}: ${e instanceof Error ? e.message : "error"}`);
        }
      };

      if (p.thumbnailUrl) {
        await callSelf("set_thumbnail", { videoId, thumbnailUrl: String(p.thumbnailUrl) });
      }
      if (p.captionsUrl) {
        await callSelf("upload_caption", {
          videoId,
          captionsUrl: String(p.captionsUrl),
          language: String(p.captionsLanguage || "en"),
          name: String(p.captionsName || "Captions"),
        });
      }
      if (p.playlistId || p.playlistName) {
        await callSelf("add_to_playlist", {
          videoId,
          playlistId: p.playlistId ? String(p.playlistId) : undefined,
          playlistName: p.playlistName ? String(p.playlistName) : undefined,
        });
      }
      if (p.pinnedComment) {
        await callSelf("pin_comment", { videoId, commentText: String(p.pinnedComment) });
      }

      return jsonOk({
        success: true,
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        warnings,
      });
    }

    throw new Error(`Unsupported action: ${action}`);
  } catch (error) {
    let message = "Unknown error";
    if (error instanceof Error) {
      message = error.message || error.toString() || "Unknown error";
    } else if (typeof error === "string") {
      message = error;
    } else if (error && typeof error === "object") {
      try {
        message = JSON.stringify(error);
      } catch {
        message = String(error);
      }
    }
    console.error("[youtube] handler error:", message, error instanceof Error ? error.stack : undefined);
    return new Response(JSON.stringify({ error: message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
