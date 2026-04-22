// Slack chat-tools edge function — multi-tenant.
// Resolution order:
//   1. Per-user OAuth bot token from integration_connections (provider='slack')
//   2. Lovable connector gateway (legacy SLACK_API_KEY) — fallback
//
// Envelope: { action, params } (nested, matches manifest).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

interface Payload {
  action: string;
  params?: Record<string, unknown>;
}

async function getUserToken(req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data } = await userClient.auth.getUser(token);
    if (!data.user) return null;
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: row } = await admin
      .from("integration_connections")
      .select("metadata")
      .eq("user_id", data.user.id)
      .eq("provider", "slack")
      .eq("status", "connected")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const meta = (row?.metadata || {}) as Record<string, unknown>;
    const t = String(meta.access_token || "");
    return t || null;
  } catch (e) {
    console.warn("[slack] getUserToken failed", e);
    return null;
  }
}

async function callDirect(
  token: string,
  endpoint: string,
  body: Record<string, unknown> | null,
  method: "GET" | "POST" = "POST",
): Promise<Record<string, unknown>> {
  let url = `https://slack.com/api/${endpoint}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
  };
  if (method === "GET" && body) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    url += `?${qs.toString()}`;
  } else if (body) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(`Slack ${endpoint} failed [${res.status}]: ${data.error || JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

async function callGateway(
  endpoint: string,
  body: Record<string, unknown> | null,
  method: "GET" | "POST" = "POST",
): Promise<Record<string, unknown>> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");
  if (!LOVABLE_API_KEY || !SLACK_API_KEY) {
    throw new Error("Slack not connected for this user (no per-user token, and no fallback connector configured)");
  }
  let url = `${GATEWAY_URL}/${endpoint}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": SLACK_API_KEY,
      "Content-Type": "application/json",
    },
  };
  if (method === "GET" && body) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    url += `?${qs.toString()}`;
  } else if (body) {
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(`Slack ${endpoint} failed [${res.status}]: ${data.error || JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

async function dispatch(
  userToken: string | null,
  action: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const call = (endpoint: string, body: Record<string, unknown> | null, method: "GET" | "POST" = "POST") =>
    userToken ? callDirect(userToken, endpoint, body, method) : callGateway(endpoint, body, method);

  switch (action) {
    case "send_message":
      return await call("chat.postMessage", params);
    case "list_channels":
      return await call("conversations.list", { types: "public_channel", limit: 100, ...params }, "GET");
    case "get_channel_history":
      return await call("conversations.history", params, "GET");
    case "search_messages":
      return await call("search.messages", params, "GET");
    case "list_users":
      return await call("users.list", { limit: 100, ...params }, "GET");
    case "lookup_user_by_email":
      return await call("users.lookupByEmail", params, "GET");
    case "create_channel":
      return await call("conversations.create", params);
    case "add_reaction":
      return await call("reactions.add", params);
    case "delete_message":
      return await call("chat.delete", params);
    default:
      throw new Error(`Unknown Slack action: ${action}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json()) as Payload;
    const action = body?.action;
    const params = body?.params ?? {};
    if (!action) throw new Error("Missing 'action' in request body");

    const userToken = await getUserToken(req);
    const data = await dispatch(userToken, action, params);
    return new Response(JSON.stringify({ success: true, data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[slack] error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
