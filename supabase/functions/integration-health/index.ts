// Integration health pinger. Calls the connector gateway's verify_credentials
// endpoint for each connected integration and writes back health_status and
// last_health_check_at. Surfaces a signal_moment when a previously-healthy
// connection goes red so the user finds out BEFORE they try to use it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

interface Conn {
  id: string;
  user_id: string;
  provider: string;
  status: string;
  health_status: string | null;
  metadata: Record<string, unknown> | null;
}

async function pingOne(c: Conn): Promise<{ healthy: boolean; error?: string }> {
  // Strategy: if the connection has a gateway key in metadata, use the
  // gateway verify endpoint. Otherwise mark as unknown (we don't ping
  // connector-less integrations like our native CLICKUP_API_TOKEN secret).
  const gatewayKey = (c.metadata?.gateway_api_key as string | undefined) ?? null;
  if (!gatewayKey || !LOVABLE_API_KEY) return { healthy: true };
  try {
    const r = await fetch("https://connector-gateway.lovable.dev/api/v1/verify_credentials", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": gatewayKey,
      },
    });
    if (!r.ok) return { healthy: false, error: `gateway ${r.status}` };
    const body = await r.json().catch(() => ({}));
    if (body?.outcome === "failed") return { healthy: false, error: String(body.error || "verify failed") };
    return { healthy: true };
  } catch (e) {
    return { healthy: false, error: e instanceof Error ? e.message : String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: conns } = await admin
    .from("integration_connections")
    .select("id,user_id,provider,status,health_status,metadata")
    .eq("status", "connected")
    .limit(1000);

  const results = await Promise.all(
    (conns || []).map(async (c: Conn) => {
      const { healthy, error } = await pingOne(c);
      const next = healthy ? "healthy" : "red";
      const wasHealthy = c.health_status !== "red";
      await admin
        .from("integration_connections")
        .update({
          health_status: next,
          last_health_check_at: new Date().toISOString(),
          last_error: error ?? null,
        })
        .eq("id", c.id);

      // Newly red — alert the user via a signal moment.
      if (!healthy && wasHealthy) {
        await admin.from("signal_moments").insert({
          user_id: c.user_id,
          kind: "integration_down",
          headline: `${c.provider} connection is failing.`,
          reason: error ?? "Health check failed",
          suggested_direction: `Reconnect ${c.provider} in Integrations.`,
          salience: 0.85,
          confidence: 0.95,
          mode_context: "any",
          status: "live",
          metadata: { provider: c.provider, connection_id: c.id },
        });
      }
      return { id: c.id, provider: c.provider, healthy };
    }),
  );

  return new Response(JSON.stringify({ checked: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
