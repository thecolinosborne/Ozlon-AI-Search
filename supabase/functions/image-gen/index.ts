import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const FALLBACK_CHAIN = [
  "google/gemini-3.1-flash-image-preview",
  "google/gemini-2.5-flash-image",
  "google/gemini-3-pro-image-preview",
];

interface ReqBody {
  prompt: string;
  model?: string;
  inputImageUrl?: string;
  userId?: string; // when called server-to-server with service role
  serviceSecret?: string; // optional shared-secret for internal calls
  routing_mode?: "speed" | "balanced" | "quality";
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

    // Internal service-role call: trust userId if Authorization is the service key.
    const authHeader = req.headers.get("Authorization") || "";
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
    const isServiceCall = bearerToken && bearerToken === serviceKey;

    if (!isServiceCall) {
      // External call: must be a real user JWT.
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
    for (const m of FALLBACK_CHAIN) if (!chain.includes(m)) chain.push(m);

    const userContent: any[] = [{ type: "text", text: body.prompt }];
    if (body.inputImageUrl) {
      userContent.push({ type: "image_url", image_url: { url: body.inputImageUrl } });
    }

    let imageDataUrl: string | null = null;
    let modelUsed = "";
    let lastError = "";

    // ── GAUNTLET SHIM: route through gauntlet-router when enabled ──
    const useGauntlet = Deno.env.get("USE_GAUNTLET") === "1";
    if (useGauntlet) {
      try {
        const gRes = await fetch(`${supabaseUrl}/functions/v1/gauntlet-router`, {
          method: "POST",
          headers: {
            Authorization: authHeader || `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            apikey: anonKey,
          },
          body: JSON.stringify({
            action: "call",
            needs: { modality: "image_gen", complexity: "medium", routing_mode: body.routing_mode },
            messages: [{ role: "user", content: body.prompt }],
            node_type: "image_artist",
            routing_mode: body.routing_mode,
          }),
        });
        if (gRes.ok) {
          const gData = await gRes.json();
          // If Higgsfield was picked, return its URL/job directly
          if (gData?.stone === "higgsfield") {
            const hfUrl = gData?.result?.higgsfield?.url;
            const reqId = gData?.result?.higgsfield?.request_id;
            if (hfUrl) {
              return new Response(
                JSON.stringify({ url: hfUrl, model: "higgsfield", mode: "generate", stone: "higgsfield" }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }
            if (reqId) {
              return new Response(
                JSON.stringify({ pending: true, provider: "higgsfield", request_id: reqId }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }
          }
          // Otherwise the gauntlet picked Lovable/Gemini for image-gen — fall through to legacy chain
          // (those drivers don't currently return an image_url field, so we use the existing flow below)
        } else {
          console.warn("[image-gen] gauntlet returned", gRes.status);
        }
      } catch (e) {
        console.warn("[image-gen] gauntlet shim failed:", e);
      }
    }

    for (const modelId of chain) {
      try {
        const resp = await fetch(GATEWAY_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: "user", content: userContent }],
            modalities: ["image", "text"],
          }),
        });
        if (!resp.ok) {
          lastError = `${modelId}: HTTP ${resp.status} ${await resp.text().catch(() => "")}`;
          if (resp.status === 429 || resp.status === 402 || resp.status >= 500) continue;
          break;
        }
        const data = await resp.json();
        const url = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        if (url) {
          imageDataUrl = url;
          modelUsed = modelId;
          break;
        }
        lastError = `${modelId}: no image in response`;
      } catch (e) {
        lastError = `${modelId}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    if (!imageDataUrl) {
      return new Response(JSON.stringify({ error: "Image generation failed", detail: lastError }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const match = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (!match) {
      return new Response(JSON.stringify({ error: "Unexpected image format" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const mime = match[1];
    const ext = mime.split("/")[1] || "png";
    const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));

    const admin = createClient(supabaseUrl, serviceKey);
    const path = `${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await admin.storage
      .from("generated-images")
      .upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) {
      return new Response(JSON.stringify({ error: "Upload failed", detail: upErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: pub } = admin.storage.from("generated-images").getPublicUrl(path);

    return new Response(
      JSON.stringify({ url: pub.publicUrl, model: modelUsed, mode: body.inputImageUrl ? "edit" : "generate" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
