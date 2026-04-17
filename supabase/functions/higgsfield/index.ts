import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE_URL = "https://platform.higgsfield.ai";

async function tryVaultRead(
  adminClient: ReturnType<typeof createClient>,
  connectionId: string,
  userId: string,
  secretName: string,
): Promise<string | null> {
  try {
    const vaultKey = Deno.env.get("VAULT_ENCRYPTION_KEY");
    if (!vaultKey) return null;
    const keyBytes = new TextEncoder().encode(vaultKey);
    if (keyBytes.length !== 32) {
      console.warn(`[higgsfield/vault] VAULT_ENCRYPTION_KEY wrong length: ${keyBytes.length}`);
      return null;
    }
    const hexKey = "\\x" + Array.from(keyBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data, error } = await adminClient.rpc("get_user_secret", {
      _connection_id: connectionId,
      _user_id: userId,
      _secret_name: secretName,
      _encryption_key: hexKey,
    });
    if (error) {
      console.warn(`[higgsfield/vault] get_user_secret(${secretName}) error:`, error.message);
      return null;
    }
    const plain = typeof data === "string" ? data.trim() : null;
    if (plain && plain.length > 0) {
      console.log(`[higgsfield/vault] read OK secret=${secretName} len=${plain.length}`);
      const { error: auditErr } = await adminClient
        .from("credential_audit_log")
        .insert({
          user_id: userId,
          connection_id: connectionId,
          provider: "higgsfield",
          action: "vault_read",
          detail: secretName,
        });
      if (auditErr) console.warn(`[higgsfield/vault] audit insert failed:`, auditErr.message);
      return plain;
    }
    console.log(`[higgsfield/vault] read empty secret=${secretName}`);
    return null;
  } catch (e) {
    console.warn("[higgsfield/vault] threw:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function resolveCredentials(
  req: Request,
  paramAppId?: string,
  paramApiKey?: string,
): Promise<{ appId: string; apiKey: string }> {
  // 1. Explicit params
  if (paramAppId && paramApiKey) return { appId: paramAppId, apiKey: paramApiKey };

  // 2. Per-user lookup (vault-first, metadata fallback)
  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const adminClient = createClient(supabaseUrl, serviceKey);
        const { data: conn } = await adminClient
          .from("integration_connections")
          .select("id, metadata")
          .eq("user_id", user.id)
          .eq("provider", "higgsfield")
          .eq("status", "connected")
          .single();

        if (conn?.id) {
          const meta = (conn.metadata as Record<string, string>) || {};
          // Vault-first for each secret, metadata fallback per-secret
          const apiKey =
            (await tryVaultRead(adminClient, conn.id, user.id, "api_key")) ||
            meta.api_key ||
            "";
          const appId =
            (await tryVaultRead(adminClient, conn.id, user.id, "app_id")) ||
            meta.app_id ||
            "";
          if (apiKey && appId) return { appId, apiKey };
        }
      }
    } catch {
      /* fall through */
    }
  }

  // No env fallback for authenticated user actions — credentials must be per-user.
  throw new Error("Higgsfield not connected. Add your API key in Integrations → Higgsfield AI.");
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
        await resolveCredentials(req, paramAppId, paramApiKey);
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
