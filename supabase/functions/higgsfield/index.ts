import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE_URL = "https://platform.higgsfield.ai";

async function resolveCredentials(req: Request, paramAppId?: string, paramApiKey?: string): Promise<{ appId: string; apiKey: string }> {
  // 1. Explicit params
  if (paramAppId && paramApiKey) return { appId: paramAppId, apiKey: paramApiKey };

  // 2. Per-user lookup
  const authHeader = req.headers.get('Authorization');
  if (authHeader) {
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const adminClient = createClient(supabaseUrl, serviceKey);
        const { data } = await adminClient
          .from('integration_connections')
          .select('metadata')
          .eq('user_id', user.id)
          .eq('provider', 'higgsfield')
          .eq('status', 'connected')
          .single();
        const meta = data?.metadata as Record<string, string> | null;
        if (meta?.api_key && meta?.app_id) return { appId: meta.app_id, apiKey: meta.api_key };
      }
    } catch { /* fall through */ }
  }

  // 3. Env fallback
  const envAppId = paramAppId || Deno.env.get("HIGGSFIELD_APP_ID");
  const envApiKey = paramApiKey || Deno.env.get("HIGGSFIELD_API_KEY");
  if (envAppId && envApiKey) return { appId: envAppId, apiKey: envApiKey };

  throw new Error("Higgsfield credentials not configured. Enter your API key in the integration settings.");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action, apiKey: paramApiKey, appId: paramAppId, ...params } = body;

    if (action === "test_connection") {
      try {
        const creds = await resolveCredentials(req, paramAppId, paramApiKey);
        return new Response(
          JSON.stringify({ success: true, data: { connected: true, note: "Dual-auth credentials configured" } }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch {
        return new Response(
          JSON.stringify({ success: false, data: { connected: false, note: "Missing credentials" } }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const { appId, apiKey } = await resolveCredentials(req, paramAppId, paramApiKey);

    const headers = {
      "Authorization": `Key ${appId}:${apiKey}`,
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
