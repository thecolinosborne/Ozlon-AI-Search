// Slack edge function — proxies to Lovable connector gateway.
// Envelope: { action, params } (nested, matches manifest).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/slack/api";

interface Payload {
  action: string;
  params?: Record<string, unknown>;
}

async function slackCall(
  endpoint: string,
  body: Record<string, unknown> | null,
  method: "GET" | "POST" = "POST",
): Promise<Record<string, unknown>> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  if (!SLACK_API_KEY) throw new Error("SLACK_API_KEY not configured (Slack connector not linked)");

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

async function dispatch(action: string, params: Record<string, unknown>): Promise<unknown> {
  switch (action) {
    case "send_message":
      return await slackCall("chat.postMessage", params);
    case "list_channels":
      return await slackCall("conversations.list", { types: "public_channel", limit: 100, ...params }, "GET");
    case "get_channel_history":
      return await slackCall("conversations.history", params, "GET");
    case "search_messages":
      return await slackCall("search.messages", params, "GET");
    case "list_users":
      return await slackCall("users.list", { limit: 100, ...params }, "GET");
    case "lookup_user_by_email":
      return await slackCall("users.lookupByEmail", params, "GET");
    case "create_channel":
      return await slackCall("conversations.create", params);
    case "add_reaction":
      return await slackCall("reactions.add", params);
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
    const data = await dispatch(action, params);
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
