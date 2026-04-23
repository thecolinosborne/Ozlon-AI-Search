// Unified send pipeline for the Communications Hub.
// Routes to the right provider (Gmail / Slack / GHL), handles HTML formatting,
// signature injection for email, optimistic cache write, and outbox queueing on failure.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface SendBody {
  channel: "email" | "slack" | "sms";
  source: "gmail" | "slack" | "ghl";
  to?: string;
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  cc?: string;
  bcc?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  // Slack
  channelId?: string;
  threadTs?: string;
  // GHL
  conversationId?: string;
}

function escHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function withSignature(html: string, signature: string | null): string {
  if (!signature) return html;
  return `${html}<br><br>--<br>${signature}`;
}

function withQuotedReply(html: string, quoted?: { from?: string; date?: string; html?: string; text?: string }) {
  if (!quoted || (!quoted.html && !quoted.text)) return html;
  const inner = quoted.html ?? `<pre style="white-space:pre-wrap">${escHtml(quoted.text || "")}</pre>`;
  const meta = quoted.from || quoted.date
    ? `<div style="color:#6b7280;font-size:12px;margin-bottom:6px">On ${escHtml(quoted.date || "")} ${escHtml(quoted.from || "")} wrote:</div>`
    : "";
  return `${html}<br><br><blockquote style="margin:0 0 0 .8ex;border-left:3px solid #e5e7eb;padding-left:1ex;color:#4b5563">${meta}${inner}</blockquote>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userRes.user.id;
    const svc = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = (await req.json()) as SendBody & {
      quoted?: { from?: string; date?: string; html?: string; text?: string };
    };

    let providerResp: unknown = null;
    let externalId: string | null = null;
    let threadExternalId: string | null = body.threadId ?? body.threadTs ?? body.conversationId ?? null;

    if (body.source === "gmail") {
      // Pull signature
      const { data: prof } = await svc
        .from("profiles")
        .select("email_signature")
        .eq("user_id", userId)
        .maybeSingle();
      const sig = (prof?.email_signature as string | null) ?? null;
      const finalHtml = withQuotedReply(withSignature(body.bodyHtml ?? `<p>${escHtml(body.bodyText ?? "")}</p>`, sig), body.quoted);
      const finalText = (body.bodyText ?? "") + (sig ? `\n\n--\n${sig.replace(/<[^>]+>/g, "")}` : "");

      const invokeRes = await userClient.functions.invoke("google-gmail", {
        body: {
          action: "send_message",
          params: {
            to: body.to,
            subject: body.subject,
            body: finalText,
            body_html: finalHtml,
            cc: body.cc,
            bcc: body.bcc,
            inReplyTo: body.inReplyTo,
            references: body.references,
            threadId: body.threadId,
          },
        },
      });
      if (invokeRes.error) throw invokeRes.error;
      providerResp = invokeRes.data;
      const id = (invokeRes.data as { message?: { id?: string; threadId?: string } })?.message;
      externalId = id?.id ?? null;
      threadExternalId = id?.threadId ?? threadExternalId;
    } else if (body.source === "slack") {
      const channel = body.channelId;
      if (!channel) throw new Error("channelId required for slack");
      const invokeRes = await userClient.functions.invoke("slack", {
        body: {
          action: "send_message",
          params: { channel, text: body.bodyText ?? "", thread_ts: body.threadTs },
        },
      });
      if (invokeRes.error) throw invokeRes.error;
      providerResp = invokeRes.data;
      const ts = (invokeRes.data as { ts?: string; message?: { ts?: string } })?.ts
        ?? (invokeRes.data as { message?: { ts?: string } })?.message?.ts
        ?? null;
      externalId = ts ? `${channel}:${ts}` : null;
      threadExternalId = body.threadTs ?? ts ?? channel;
    } else if (body.source === "ghl") {
      const conversationId = body.conversationId;
      if (!conversationId) throw new Error("conversationId required for ghl");
      const invokeRes = await userClient.functions.invoke("gohighlevel", {
        body: {
          action: "send_message",
          params: { conversationId, message: body.bodyText ?? "", type: body.channel === "sms" ? "SMS" : "Email" },
        },
      });
      if (invokeRes.error) throw invokeRes.error;
      providerResp = invokeRes.data;
      threadExternalId = conversationId;
    } else {
      throw new Error(`unsupported source: ${body.source}`);
    }

    // Optimistic cache write — appears immediately in stream.
    const cacheExternalId = externalId ?? `out:${crypto.randomUUID()}`;
    await svc.from("communications_messages").upsert(
      {
        user_id: userId,
        source: body.source,
        external_id: cacheExternalId,
        thread_external_id: threadExternalId,
        channel: body.channel,
        channel_label: body.channel === "email" ? "Email (sent)" : body.channel === "slack" ? "Slack (sent)" : "SMS (sent)",
        from_name: "You",
        from_handle: null,
        subject: body.subject ?? null,
        preview: (body.bodyText ?? body.bodyHtml ?? "").replace(/<[^>]+>/g, "").slice(0, 200),
        body_text: body.bodyText ?? null,
        received_at: new Date().toISOString(),
        is_unread: false,
        needs_reply: false,
        raw: { sent: true, response: providerResp },
      },
      { onConflict: "user_id,source,external_id" },
    );

    return new Response(
      JSON.stringify({ ok: true, data: { externalId: cacheExternalId, threadExternalId } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("communications-send error:", e);
    const msg = e instanceof Error ? e.message : "send failed";
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
