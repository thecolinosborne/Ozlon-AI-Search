// Slack Events webhook — multi-tenant. Each install stores its own bot token
// in `integration_connections` (provider='slack', auth_type='oauth2'). On each
// event we look up the workspace by team_id and use that workspace's token.
//
// Public function (verify_jwt = false). Signing secret is app-level (single global).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-slack-signature, x-slack-request-timestamp",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET");
const SLACK_BOT_TOKEN_FALLBACK = Deno.env.get("SLACK_BOT_TOKEN"); // back-compat
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---- Slack signature verification (HMAC SHA-256) ----
async function verifySlackSignature(req: Request, rawBody: string): Promise<boolean> {
  if (!SLACK_SIGNING_SECRET) return false;
  const ts = req.headers.get("x-slack-request-timestamp");
  const sig = req.headers.get("x-slack-signature");
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false;

  const baseString = `v0:${ts}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SLACK_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(baseString));
  const mac = Array.from(new Uint8Array(macBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expected = `v0=${mac}`;
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// ---- Per-team workspace resolution ----
interface Workspace {
  token: string;
  botUserId: string | null;
  teamId: string;
  userId: string | null; // owning Ozlon user
}

const wsCache = new Map<string, { ws: Workspace; at: number }>();
const WS_CACHE_MS = 5 * 60 * 1000;

async function resolveWorkspace(teamId: string | undefined): Promise<Workspace | null> {
  if (teamId) {
    const cached = wsCache.get(teamId);
    if (cached && Date.now() - cached.at < WS_CACHE_MS) return cached.ws;

    const { data } = await sb
      .from("integration_connections")
      .select("user_id, metadata")
      .eq("provider", "slack")
      .eq("status", "connected")
      .filter("metadata->>team_id", "eq", teamId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      const meta = (data.metadata || {}) as Record<string, unknown>;
      const token = String(meta.access_token || "");
      if (token) {
        const ws: Workspace = {
          token,
          botUserId: (meta.bot_user_id as string) || null,
          teamId,
          userId: data.user_id as string,
        };
        wsCache.set(teamId, { ws, at: Date.now() });
        return ws;
      }
    }
  }

  // Back-compat fallback to global env token (single-workspace legacy mode)
  if (SLACK_BOT_TOKEN_FALLBACK) {
    return { token: SLACK_BOT_TOKEN_FALLBACK, botUserId: null, teamId: teamId || "legacy", userId: null };
  }
  return null;
}

async function slackApi(
  ws: Workspace,
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ws.token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return await res.json();
}

async function ensureBotUserId(ws: Workspace): Promise<string | null> {
  if (ws.botUserId) return ws.botUserId;
  const r = await slackApi(ws, "auth.test", {});
  ws.botUserId = (r.user_id as string) || null;
  return ws.botUserId;
}

// ---- AI reply via Lovable AI Gateway ----
async function generateAiReply(userText: string, contextMessages: string[]): Promise<string> {
  if (!LOVABLE_API_KEY) return "AI is not configured.";
  const messages = [
    {
      role: "system",
      content:
        "You are Ozlon, a calm, wise, concise AI assistant replying inside Slack. " +
        "Keep responses short, helpful, and use Slack mrkdwn (use *bold*, _italic_, `code`). " +
        "Avoid markdown headers and tables. Aim for 1-4 sentences unless detail is required.",
    },
    ...contextMessages.map((m) => ({ role: "user" as const, content: m })),
    { role: "user" as const, content: userText },
  ];

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-3-flash-preview", messages }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error("AI gateway error", res.status, txt);
    if (res.status === 429) return "I'm rate-limited right now — try again in a moment.";
    if (res.status === 402) return "AI credits exhausted. Add funds in Lovable to continue.";
    return "Something went wrong reaching the AI.";
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content as string) || "(no response)";
}

function stripBotMention(text: string, botId: string): string {
  return text.replace(new RegExp(`<@${botId}>`, "g"), "").trim();
}

async function shouldRespond(event: Record<string, unknown>, botId: string): Promise<boolean> {
  const type = event.type as string;
  const subtype = event.subtype as string | undefined;
  const channelType = event.channel_type as string | undefined;
  const text = (event.text as string) || "";
  const user = event.user as string | undefined;
  const threadTs = event.thread_ts as string | undefined;
  const channel = event.channel as string | undefined;

  if (!user || user === botId) return false;
  if ((event.bot_id as string | undefined)) return false;
  if (subtype && subtype !== "thread_broadcast") return false;

  if (type === "app_mention") return true;
  if (type === "message" && channelType === "im") return true;

  if (type === "message" && threadTs && channel) {
    const { data } = await sb
      .from("slack_processed_events")
      .select("id")
      .eq("channel", channel)
      .eq("thread_ts", threadTs)
      .limit(1)
      .maybeSingle();
    if (data) return true;
  }

  if (type === "message" && text.includes(`<@${botId}>`)) return true;
  return false;
}

async function fetchThreadContext(ws: Workspace, channel: string, threadTs: string, limit = 8): Promise<string[]> {
  try {
    const r = await slackApi(ws, "conversations.replies", { channel, ts: threadTs, limit });
    const msgs = (r.messages as Array<{ text?: string; user?: string }>) || [];
    return msgs.map((m) => m.text || "").filter(Boolean).slice(-limit);
  } catch (e) {
    console.warn("fetchThreadContext failed", e);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const rawBody = await req.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("invalid json", { status: 400, headers: corsHeaders });
  }

  // Slack URL verification handshake
  if (payload.type === "url_verification") {
    return new Response(JSON.stringify({ challenge: payload.challenge }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const valid = await verifySlackSignature(req, rawBody);
  if (!valid) {
    console.warn("[slack-events] invalid signature");
    return new Response("invalid signature", { status: 401, headers: corsHeaders });
  }

  const eventId = (payload.event_id as string) || crypto.randomUUID();
  const teamId = (payload.team_id as string) || ((payload.team as string) ?? undefined);

  // Dedupe
  const { data: existing } = await sb
    .from("slack_processed_events")
    .select("id")
    .eq("event_id", eventId)
    .maybeSingle();
  if (existing) return new Response("ok", { headers: corsHeaders });

  const event = (payload.event as Record<string, unknown>) || {};

  (async () => {
    try {
      const ws = await resolveWorkspace(teamId);
      if (!ws) {
        console.error("[slack-events] no workspace token for team", teamId);
        await sb.from("slack_processed_events").insert({
          event_id: eventId,
          event_type: (event.type as string) || null,
          channel: (event.channel as string) || null,
          status: "error",
          error_message: `no token for team ${teamId}`,
        });
        return;
      }

      const botId = await ensureBotUserId(ws);
      if (!botId) {
        console.error("Could not resolve bot user id for team", ws.teamId);
        return;
      }

      const respond = await shouldRespond(event, botId);
      if (!respond) {
        await sb.from("slack_processed_events").insert({
          event_id: eventId,
          event_type: event.type as string,
          channel: (event.channel as string) || null,
          user_id_slack: (event.user as string) || null,
          thread_ts: (event.thread_ts as string) || null,
          status: "skipped",
        });
        return;
      }

      const channel = event.channel as string;
      const userText = stripBotMention((event.text as string) || "", botId);
      const threadTs = (event.thread_ts as string) || (event.ts as string);

      const context =
        threadTs && threadTs !== (event.ts as string)
          ? await fetchThreadContext(ws, channel, threadTs)
          : [];

      const reply = await generateAiReply(userText || "(no message text)", context);

      const post = await slackApi(ws, "chat.postMessage", {
        channel,
        text: reply,
        thread_ts: threadTs,
      });

      const responseTs = (post.ts as string) || null;

      await sb.from("slack_processed_events").insert({
        event_id: eventId,
        event_type: event.type as string,
        channel,
        user_id_slack: (event.user as string) || null,
        thread_ts: threadTs,
        response_ts: responseTs,
        status: post.ok ? "replied" : "error",
        error_message: post.ok ? null : ((post.error as string) || "post failed"),
      });
    } catch (e) {
      console.error("[slack-events] background error:", e);
      try {
        await sb.from("slack_processed_events").insert({
          event_id: eventId,
          event_type: (event.type as string) || null,
          channel: (event.channel as string) || null,
          status: "error",
          error_message: e instanceof Error ? e.message : String(e),
        });
      } catch (_) { /* ignore */ }
    }
  })();

  return new Response("ok", { headers: corsHeaders });
});
