// Slack Events webhook — receives @mentions, DMs, and thread replies, then
// generates an AI reply via Lovable AI Gateway and posts it back to Slack.
//
// Setup steps for the user:
// 1. Create custom Slack app from manifest at https://api.slack.com/apps
// 2. Install app to workspace, copy Bot User OAuth Token + Signing Secret
// 3. Add SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET as Supabase secrets
//
// This function MUST be public (verify_jwt = false) so Slack can hit it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-slack-signature, x-slack-request-timestamp",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---- Slack signature verification (HMAC SHA-256) ----
async function verifySlackSignature(req: Request, rawBody: string): Promise<boolean> {
  if (!SLACK_SIGNING_SECRET) return false;
  const ts = req.headers.get("x-slack-request-timestamp");
  const sig = req.headers.get("x-slack-signature");
  if (!ts || !sig) return false;
  // Reject replays older than 5 minutes
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
  // constant-time compare
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// ---- Slack Web API helpers ----
async function slackApi(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  return await res.json();
}

let cachedBotUserId: string | null = null;
async function getBotUserId(): Promise<string | null> {
  if (cachedBotUserId) return cachedBotUserId;
  const r = await slackApi("auth.test", {});
  cachedBotUserId = (r.user_id as string) || null;
  return cachedBotUserId;
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
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages,
    }),
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

// Strip <@BOTID> mention tokens from text
function stripBotMention(text: string, botId: string): string {
  return text.replace(new RegExp(`<@${botId}>`, "g"), "").trim();
}

// ---- Decide whether to respond ----
// Behavior: @mentions, DMs, and any reply in a thread the bot has already participated in.
async function shouldRespond(event: Record<string, unknown>, botId: string): Promise<boolean> {
  const type = event.type as string;
  const subtype = event.subtype as string | undefined;
  const channelType = event.channel_type as string | undefined;
  const text = (event.text as string) || "";
  const user = event.user as string | undefined;
  const threadTs = event.thread_ts as string | undefined;
  const channel = event.channel as string | undefined;

  // Ignore bot's own messages, message edits/joins/leaves, system subtypes
  if (!user || user === botId) return false;
  if ((event.bot_id as string | undefined)) return false;
  if (subtype && subtype !== "thread_broadcast") return false;

  // app_mention always responds
  if (type === "app_mention") return true;

  // DM: channel_type === "im"
  if (type === "message" && channelType === "im") return true;

  // Thread reply where bot already participated
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

  // Direct mention inside a regular channel message (defensive — usually app_mention covers this)
  if (type === "message" && text.includes(`<@${botId}>`)) return true;

  return false;
}

// Fetch a small slice of thread context for better replies
async function fetchThreadContext(channel: string, threadTs: string, limit = 8): Promise<string[]> {
  try {
    const r = await slackApi("conversations.replies", {
      channel,
      ts: threadTs,
      limit,
    });
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

  // Slack URL verification handshake — must respond with the challenge
  if (payload.type === "url_verification") {
    return new Response(
      JSON.stringify({ challenge: payload.challenge }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Verify signature for everything else
  const valid = await verifySlackSignature(req, rawBody);
  if (!valid) {
    console.warn("[slack-events] invalid signature");
    return new Response("invalid signature", { status: 401, headers: corsHeaders });
  }

  if (!SLACK_BOT_TOKEN) {
    console.error("SLACK_BOT_TOKEN not configured");
    return new Response("ok", { headers: corsHeaders }); // ack to avoid retries
  }

  // Acknowledge fast, then process in background (Slack expects <3s response)
  const eventId = (payload.event_id as string) || crypto.randomUUID();

  // Dedupe — Slack retries deliveries
  const { data: existing } = await sb
    .from("slack_processed_events")
    .select("id")
    .eq("event_id", eventId)
    .maybeSingle();
  if (existing) {
    return new Response("ok", { headers: corsHeaders });
  }

  const event = (payload.event as Record<string, unknown>) || {};

  // Background work — don't block the Slack ACK
  (async () => {
    try {
      const botId = await getBotUserId();
      if (!botId) {
        console.error("Could not resolve bot user id");
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

      // Pull a little thread context for better replies
      const context =
        threadTs && threadTs !== (event.ts as string)
          ? await fetchThreadContext(channel, threadTs)
          : [];

      const reply = await generateAiReply(userText || "(no message text)", context);

      const post = await slackApi("chat.postMessage", {
        channel,
        text: reply,
        thread_ts: threadTs, // always reply in-thread
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
