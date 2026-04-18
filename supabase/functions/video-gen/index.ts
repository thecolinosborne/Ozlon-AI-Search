// ============================================================================
// VIDEO-GEN — AI video generation via Lovable AI Gateway (Veo 3 family),
// with automatic fallback to Higgsfield AI for users who have it connected.
// Uploads the result to the public `generated-videos` bucket.
// ============================================================================

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const VEO_CHAIN = ["google/veo-3-fast", "google/veo-3"];

interface ReqBody {
  prompt: string;
  duration?: number;            // seconds, 5 or 10
  aspect_ratio?: string;        // 16:9, 9:16, 1:1
  model?: string;
  userId?: string;              // present on service-role calls
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as ReqBody;
    let userId = body.userId;

    const authHeader = req.headers.get("Authorization") || "";
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
    const isServiceCall = bearerToken && bearerToken === serviceKey;

    if (!isServiceCall) {
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = userData.user.id;
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "userId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body?.prompt || typeof body.prompt !== "string") {
      return new Response(JSON.stringify({ error: "prompt required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const chain: string[] = [];
    if (body.model) chain.push(body.model);
    for (const m of VEO_CHAIN) if (!chain.includes(m)) chain.push(m);

    let videoUrl: string | null = null;
    let modelUsed = "";
    let lastError = "";

    for (const modelId of chain) {
      try {
        const resp = await fetch(GATEWAY_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: "user", content: body.prompt }],
            modalities: ["video", "text"],
            video: {
              duration_seconds: body.duration || 5,
              aspect_ratio: body.aspect_ratio || "16:9",
            },
          }),
        });
        if (!resp.ok) {
          lastError = `${modelId}: HTTP ${resp.status} ${await resp.text().catch(() => "")}`;
          if (resp.status === 429 || resp.status === 402 || resp.status >= 500) continue;
          break;
        }
        const data = await resp.json();
        const url =
          data?.choices?.[0]?.message?.videos?.[0]?.video_url?.url ||
          data?.choices?.[0]?.message?.video_url ||
          data?.video_url;
        if (url) {
          videoUrl = url;
          modelUsed = modelId;
          break;
        }
        lastError = `${modelId}: no video in response`;
      } catch (e) {
        lastError = `${modelId}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // Higgsfield fallback if Veo chain failed and the user has it connected
    if (!videoUrl) {
      try {
        const admin = createClient(supabaseUrl, serviceKey);
        const { data: hfConn } = await admin
          .from("integration_connections")
          .select("id, status")
          .eq("user_id", userId)
          .eq("provider", "higgsfield")
          .eq("status", "connected")
          .maybeSingle();

        if (hfConn) {
          const hfRes = await fetch(`${supabaseUrl}/functions/v1/higgsfield`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              action: "generate_video",
              params: { prompt: body.prompt, duration: body.duration || 5 },
            }),
          });
          if (hfRes.ok) {
            const hfData = await hfRes.json();
            const reqId = hfData?.data?.request_id || hfData?.data?.id;
            if (reqId) {
              return new Response(
                JSON.stringify({
                  pending: true,
                  provider: "higgsfield",
                  request_id: reqId,
                  message:
                    "Higgsfield video job started. Use higgsfield_get_job_status to poll for completion.",
                }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }
          }
        }
      } catch (e) {
        console.warn("[video-gen] Higgsfield fallback failed:", e);
      }
    }

    if (!videoUrl) {
      return new Response(
        JSON.stringify({ error: "Video generation failed", detail: lastError }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Download & re-upload to our storage so URLs don't expire
    let mime = "video/mp4";
    let bytes: Uint8Array;
    try {
      if (videoUrl.startsWith("data:")) {
        const m = videoUrl.match(/^data:(video\/[a-z0-9]+);base64,(.+)$/);
        if (!m) throw new Error("bad data url");
        mime = m[1];
        bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
      } else {
        const r = await fetch(videoUrl);
        if (!r.ok) throw new Error(`fetch ${r.status}`);
        mime = r.headers.get("content-type") || "video/mp4";
        bytes = new Uint8Array(await r.arrayBuffer());
      }
    } catch (e) {
      // Couldn't re-upload — just return the upstream URL.
      return new Response(
        JSON.stringify({ url: videoUrl, model: modelUsed, hosted: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ext = mime.includes("webm") ? "webm" : "mp4";
    const admin = createClient(supabaseUrl, serviceKey);
    const path = `${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await admin.storage
      .from("generated-videos")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) {
      return new Response(
        JSON.stringify({ url: videoUrl, model: modelUsed, hosted: false, upload_error: upErr.message }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { data: pub } = admin.storage.from("generated-videos").getPublicUrl(path);

    return new Response(
      JSON.stringify({ url: pub.publicUrl, model: modelUsed, hosted: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
