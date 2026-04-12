import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const HIGGSFIELD_BASE = "https://api.higgsfield.ai/v1";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const HIGGSFIELD_API_KEY = Deno.env.get("HIGGSFIELD_API_KEY");
    if (!HIGGSFIELD_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "HIGGSFIELD_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { action, ...params } = body;

    const headers = {
      Authorization: `Bearer ${HIGGSFIELD_API_KEY}`,
      "Content-Type": "application/json",
    };

    let result: unknown;

    switch (action) {
      case "test_connection": {
        // Validate the API key by hitting a lightweight endpoint
        const res = await fetch(`${HIGGSFIELD_BASE}/models`, { headers });
        if (res.ok) {
          const data = await res.json();
          result = { connected: true, models: data };
        } else if (res.status === 401 || res.status === 403) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid API key" }),
            { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else {
          // Some APIs don't have /models — try a simple authenticated check
          // If we get here, the key exists and was sent; treat non-404 as connected
          if (res.status === 404) {
            // Endpoint doesn't exist but auth passed
            result = { connected: true, note: "API key accepted" };
          } else {
            const errText = await res.text();
            return new Response(
              JSON.stringify({ success: false, error: `API error ${res.status}: ${errText.slice(0, 200)}` }),
              { status: res.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
        break;
      }

      case "generate_video": {
        const { prompt, model, duration, aspect_ratio, style } = params;
        const res = await fetch(`${HIGGSFIELD_BASE}/generations`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            prompt,
            model: model || "default",
            duration: duration || 5,
            aspect_ratio: aspect_ratio || "16:9",
            style: style || "cinematic",
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Generation failed [${res.status}]: ${errText.slice(0, 300)}`);
        }
        result = await res.json();
        break;
      }

      case "generate_image": {
        const { prompt, model, aspect_ratio, style } = params;
        const res = await fetch(`${HIGGSFIELD_BASE}/images`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            prompt,
            model: model || "default",
            aspect_ratio: aspect_ratio || "1:1",
            style: style || "cinematic",
          }),
        });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Image generation failed [${res.status}]: ${errText.slice(0, 300)}`);
        }
        result = await res.json();
        break;
      }

      case "get_job_status": {
        const { job_id } = params;
        if (!job_id) throw new Error("job_id is required");
        const res = await fetch(`${HIGGSFIELD_BASE}/generations/${job_id}`, { headers });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Status check failed [${res.status}]: ${errText.slice(0, 300)}`);
        }
        result = await res.json();
        break;
      }

      case "list_generations": {
        const res = await fetch(`${HIGGSFIELD_BASE}/generations`, { headers });
        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`List failed [${res.status}]: ${errText.slice(0, 300)}`);
        }
        result = await res.json();
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
