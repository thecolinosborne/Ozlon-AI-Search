import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE_URL = "https://platform.higgsfield.ai";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const HIGGSFIELD_APP_ID = Deno.env.get("HIGGSFIELD_APP_ID");
    const HIGGSFIELD_API_KEY = Deno.env.get("HIGGSFIELD_API_KEY");

    const body = await req.json();
    const { action, ...params } = body;

    if (action === "test_connection") {
      const configured = !!HIGGSFIELD_APP_ID && !!HIGGSFIELD_API_KEY;
      return new Response(
        JSON.stringify({ success: configured, data: { connected: configured, note: configured ? "Dual-auth credentials configured" : "Missing credentials" } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!HIGGSFIELD_APP_ID || !HIGGSFIELD_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "Backend credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const headers = {
      "Authorization": `Key ${HIGGSFIELD_APP_ID}:${HIGGSFIELD_API_KEY}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    let result: unknown;

    switch (action) {
      case "generate_image": {
        const { prompt, model, aspect_ratio, resolution } = params;
        const modelId = model || "higgsfield-ai/soul/standard";
        const res = await fetch(`${BASE_URL}/${modelId}`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            prompt,
            aspect_ratio: aspect_ratio || "16:9",
            resolution: resolution || "720p",
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Image generation failed [${res.status}]: ${errText.slice(0, 300)}`);
        }
        result = await res.json();
        break;
      }

      case "generate_video": {
        const { image_url, prompt, model, duration } = params;
        if (!image_url) throw new Error("image_url is required for video generation");
        const modelId = model || "higgsfield-ai/dop/standard";
        const res = await fetch(`${BASE_URL}/${modelId}`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            image_url,
            prompt: prompt || "",
            duration: duration || 5,
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Video generation failed [${res.status}]: ${errText.slice(0, 300)}`);
        }
        result = await res.json();
        break;
      }

      case "get_job_status": {
        const { request_id } = params;
        if (!request_id) throw new Error("request_id is required");
        const res = await fetch(`${BASE_URL}/requests/${request_id}/status`, { headers });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Status check failed [${res.status}]: ${errText.slice(0, 300)}`);
        }
        result = await res.json();
        break;
      }

      case "cancel_job": {
        const { request_id } = params;
        if (!request_id) throw new Error("request_id is required");
        const res = await fetch(`${BASE_URL}/requests/${request_id}/cancel`, {
          method: "POST",
          headers,
        });
        if (res.status === 202) {
          result = { cancelled: true };
        } else {
          const errText = await res.text();
          throw new Error(`Cancel failed [${res.status}]: ${errText.slice(0, 300)}`);
        }
        break;
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("higgsfield error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
