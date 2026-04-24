// Fetches normalized message threads across Gmail / Slack / GHL.
// Best-effort: any failure returns { messages: [], error } so the UI never blanks.

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SLACK_GATEWAY = "https://connector-gateway.lovable.dev/slack/api";

type Source = "gmail" | "slack" | "ghl";

interface ThreadMessage {
  id: string;
  fromName: string;
  fromHandle?: string;
  direction: "in" | "out";
  body: string;
  sentAt: string;
  attachments?: Array<{ filename: string; mimeType?: string; size?: number; attachmentId?: string }>;
}

interface ReqBody {
  source: Source;
  threadId: string;
  messageId?: string;
  // Slack-only: messageId carries `slack:<channel>:<ts>`
}

// ───────────────── helpers ─────────────────

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function invokeFn(fnName: string, body: unknown, authHeader: string | null) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${fnName} ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

function decodeHeader(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  if (!headers) return "";
  const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

function parseFromHeader(from: string): { name: string; handle: string } {
  const m = from.match(/^(.*?)<(.+?)>\s*$/);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, "") || m[2], handle: m[2] };
  return { name: from.trim() || "(unknown)", handle: from.trim() };
}

function b64urlDecode(s: string): string {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + ((4 - (s.length % 4)) % 4), "=");
    const bytes = atob(b64);
    return decodeURIComponent(escape(bytes));
  } catch {
    return "";
  }
}

function stripHtml(html: string): string {
  let out = html
    // Drop entire blocks that produce noise
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<img[^>]*>/gi, "") // drop tracking pixels + inline images
    // Fold gmail/outlook quoted blocks into a single marker
    .replace(/<blockquote[^>]*class="gmail_quote"[\s\S]*?<\/blockquote>/gi, "\n\n--- earlier ---\n")
    .replace(/<div[^>]*class="gmail_quote"[\s\S]*?<\/div>/gi, "\n\n--- earlier ---\n")
    // Standard text shaping
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Strip zero-width / soft-hyphen / BOM
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Fold "On <date> <name> wrote:" tails into the same marker (only first occurrence).
  out = out.replace(
    /\n*On\s.+?\swrote:[\s\S]*$/m,
    "\n\n--- earlier ---",
  );

  return out;
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

function extractGmailBody(payload: GmailPart | undefined): { text: string; attachments: ThreadMessage["attachments"] } {
  let plain = "";
  let html = "";
  const attachments: NonNullable<ThreadMessage["attachments"]> = [];

  function walk(p: GmailPart | undefined) {
    if (!p) return;
    const mt = (p.mimeType || "").toLowerCase();
    if (p.filename && p.body?.attachmentId) {
      attachments.push({
        filename: p.filename,
        mimeType: p.mimeType,
        size: p.body.size,
        attachmentId: p.body.attachmentId,
      });
    }
    if (mt === "text/plain" && p.body?.data && !plain) {
      plain = b64urlDecode(p.body.data);
    } else if (mt === "text/html" && p.body?.data && !html) {
      html = b64urlDecode(p.body.data);
    }
    if (p.parts) for (const child of p.parts) walk(child);
  }
  walk(payload);

  const text = plain || (html ? stripHtml(html) : "");
  return { text: text.trim(), attachments: attachments.length ? attachments : undefined };
}

// ───────────────── gmail ─────────────────

async function fetchGmailThread(threadId: string, authHeader: string | null): Promise<ThreadMessage[]> {
  const data = (await invokeFn(
    "google-gmail",
    { action: "get_thread", params: { id: threadId, format: "full" } },
    authHeader,
  )) as { thread?: { messages?: Array<Record<string, unknown>> } };

  const msgs = data?.thread?.messages || [];
  const out: ThreadMessage[] = [];
  for (const m of msgs) {
    const id = String(m.id || "");
    const internalDate = m.internalDate ? Number(m.internalDate) : Date.now();
    const labels = (m.labelIds as string[] | undefined) || [];
    const payload = m.payload as { headers?: Array<{ name: string; value: string }> } & GmailPart;
    const fromRaw = decodeHeader(payload?.headers, "From");
    const { name, handle } = parseFromHeader(fromRaw);
    const { text, attachments } = extractGmailBody(payload);
    const direction: "in" | "out" = labels.includes("SENT") ? "out" : "in";
    out.push({
      id: `gmail:${id}`,
      fromName: name,
      fromHandle: handle,
      direction,
      body: text || (m.snippet as string | undefined) || "",
      sentAt: new Date(internalDate).toISOString(),
      attachments,
    });
  }
  out.sort((a, b) => +new Date(a.sentAt) - +new Date(b.sentAt));
  return out;
}

// ───────────────── slack ─────────────────

async function slackGateway(endpoint: string, qs: Record<string, string | number> = {}) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");
  if (!LOVABLE_API_KEY || !SLACK_API_KEY) return null;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(qs)) params.set(k, String(v));
  const url = `${SLACK_GATEWAY}/${endpoint}${params.toString() ? `?${params}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": SLACK_API_KEY,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data as { ok?: boolean }).ok === false) return null;
  return data as Record<string, unknown>;
}

async function fetchSlackThread(messageId: string): Promise<ThreadMessage[]> {
  // messageId is "slack:<channel>:<ts>"
  const parts = messageId.split(":");
  if (parts.length < 3) return [];
  const channel = parts[1];
  const ts = parts.slice(2).join(":");

  // Auth identity (so we can mark direction)
  const auth = await slackGateway("auth.test");
  const selfId = (auth?.user_id as string) || "";

  // Pull replies; if not a thread, fetch just this message via history
  let messages: Array<{ ts: string; text?: string; user?: string; bot_id?: string }> = [];
  const replies = await slackGateway("conversations.replies", { channel, ts, limit: 50 });
  if (replies && Array.isArray(replies.messages)) {
    messages = replies.messages as typeof messages;
  } else {
    const hist = await slackGateway("conversations.history", {
      channel,
      latest: ts,
      inclusive: "true" as unknown as string,
      limit: 1,
    });
    if (hist && Array.isArray(hist.messages)) messages = hist.messages as typeof messages;
  }
  if (messages.length === 0) return [];

  // Resolve user names (best-effort)
  const userIds = Array.from(new Set(messages.map((m) => m.user).filter(Boolean) as string[]));
  const userNames = new Map<string, string>();
  await Promise.all(
    userIds.slice(0, 20).map(async (uid) => {
      const u = await slackGateway("users.info", { user: uid });
      const profile = u?.user as { real_name?: string; profile?: { display_name?: string }; name?: string } | undefined;
      const nm = profile?.real_name || profile?.profile?.display_name || profile?.name;
      if (nm) userNames.set(uid, nm);
    }),
  );

  return messages
    .map<ThreadMessage>((m) => {
      const uid = m.user || "";
      const isSelf = !!selfId && uid === selfId;
      const name = userNames.get(uid) || (m.bot_id ? "Bot" : uid || "Slack user");
      return {
        id: `slack:${channel}:${m.ts}`,
        fromName: name,
        fromHandle: uid || undefined,
        direction: isSelf ? "out" : "in",
        body: (m.text || "").trim() || "(no text)",
        sentAt: new Date(Number(m.ts.split(".")[0]) * 1000).toISOString(),
      };
    })
    .sort((a, b) => +new Date(a.sentAt) - +new Date(b.sentAt));
}

// ───────────────── ghl ─────────────────

async function fetchGhlThread(conversationId: string, authHeader: string | null): Promise<ThreadMessage[]> {
  const data = (await invokeFn(
    "gohighlevel",
    { action: "get_conversation_messages", params: { conversationId } },
    authHeader,
  )) as { messages?: { messages?: Array<Record<string, unknown>> } | Array<Record<string, unknown>> };

  // GHL response can be either {messages:[...]} or {messages:{messages:[...]}}
  let raw: Array<Record<string, unknown>> = [];
  if (Array.isArray(data?.messages)) raw = data.messages as Array<Record<string, unknown>>;
  else if (data?.messages && Array.isArray((data.messages as { messages?: unknown }).messages)) {
    raw = (data.messages as { messages: Array<Record<string, unknown>> }).messages;
  }

  return raw
    .map<ThreadMessage>((m) => {
      const direction: "in" | "out" = String(m.direction || "").toLowerCase() === "outbound" ? "out" : "in";
      const sentAt = (m.dateAdded || m.dateUpdated || new Date().toISOString()) as string;
      const fromName =
        (m.contactName as string) ||
        (direction === "out" ? "You" : "Contact");
      const body =
        (m.body as string) ||
        (m.message as string) ||
        (m.attachments && Array.isArray(m.attachments) ? "(attachment)" : "");
      return {
        id: `ghl:${m.id || m.messageId || crypto.randomUUID()}`,
        fromName,
        direction,
        body: String(body).trim() || "(no text)",
        sentAt: new Date(sentAt).toISOString(),
      };
    })
    .sort((a, b) => +new Date(a.sentAt) - +new Date(b.sentAt));
}

// ───────────────── handler ─────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: ReqBody;
  try {
    body = await req.json();
  } catch {
    return jsonRes({ messages: [], error: "invalid json" }, 400);
  }

  const authHeader = req.headers.get("Authorization");

  try {
    let messages: ThreadMessage[] = [];
    if (body.source === "gmail") {
      messages = await fetchGmailThread(body.threadId, authHeader);
    } else if (body.source === "slack") {
      messages = await fetchSlackThread(body.messageId || `slack:${body.threadId}:`);
    } else if (body.source === "ghl") {
      messages = await fetchGhlThread(body.threadId, authHeader);
    } else {
      return jsonRes({ messages: [], error: "unknown source" }, 400);
    }
    return jsonRes({ messages });
  } catch (e) {
    console.warn("[comms-thread] failed:", e instanceof Error ? e.message : e);
    return jsonRes({ messages: [], error: e instanceof Error ? e.message : "unknown" });
  }
});
