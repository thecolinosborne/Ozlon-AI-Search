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
  await ytFetch("/search?part=snippet&type=video&maxResults=1&q=productivity", apiKey);
}

function maskKey(apiKey: string): string {
  const tail = apiKey.slice(-4);
  return `***${tail}`;
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

    if (action === "connect") {
      const apiKey = String((params as AnyJson).apiKey || "").trim();
      const channelId = String((params as AnyJson).channelId || "").trim();
      const accountLabel = String((params as AnyJson).accountLabel || "Primary YouTube").trim();
      if (!apiKey) throw new Error("apiKey is required");

      await validateApiKey(apiKey);

      const upsertPayload = {
        user_id: userId,
        provider: "youtube",
        auth_type: "api_key",
        credential_ref: "client_managed_api_key",
        status: "connected",
        external_account_id: channelId || null,
        external_account_label: accountLabel,
        last_validated_at: new Date().toISOString(),
        last_error: null,
        metadata: {
          credential_mode: "client_managed",
          api_key_masked: maskKey(apiKey),
        },
      };

      const { data, error } = await adminClient
        .from("integration_connections")
        .upsert(upsertPayload, { onConflict: "user_id,provider,auth_type,external_account_id" })
        .select("*")
        .single();
      if (error) throw error;

      return new Response(JSON.stringify({ success: true, connection: data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "test_connection") {
      const apiKey = String((params as AnyJson).apiKey || "").trim();
      if (!apiKey) throw new Error("apiKey is required");
      await validateApiKey(apiKey);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "disconnect") {
      const connectionId = String((params as AnyJson).connectionId || "").trim();
      if (!connectionId) throw new Error("connectionId is required");

      const { error } = await adminClient
        .from("integration_connections")
        .update({ status: "disconnected", last_error: null })
        .eq("id", connectionId)
        .eq("user_id", userId)
        .eq("provider", "youtube");
      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "sync_channels") {
      const apiKey = String((params as AnyJson).apiKey || "").trim();
      const connectionId = String((params as AnyJson).connectionId || "").trim();
      const channelId = String((params as AnyJson).channelId || "").trim();
      if (!apiKey || !connectionId || !channelId) {
        throw new Error("apiKey, connectionId, and channelId are required");
      }

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

        return new Response(JSON.stringify({ success: true, recordsProcessed: channelRows.length }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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

    if (action === "sync_videos") {
      const apiKey = String((params as AnyJson).apiKey || "").trim();
      const connectionId = String((params as AnyJson).connectionId || "").trim();
      const channelId = String((params as AnyJson).channelId || "").trim();
      const maxResults = Number((params as AnyJson).maxResults || 10);
      if (!apiKey || !connectionId || !channelId) {
        throw new Error("apiKey, connectionId, and channelId are required");
      }

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

        return new Response(JSON.stringify({ success: true, recordsProcessed: videoRows.length }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
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

      return new Response(JSON.stringify({ success: true, runs: data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unsupported action: ${action}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
