// Communications aggregator — fans out to Gmail, Slack, GHL in parallel.
// Each source is best-effort: failures are logged and that source returns []
// so the unified stream still renders. CommMessage shape is identical across
// sources so the frontend renders one feed.

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

interface PriorityItem {
  id: string;
  channel: "email" | "slack" | "sms" | "voicemail";
  who: string;
  what: string;
  channelLabel: string;
}

interface CommMessage {
  id: string;
  channel: "email" | "slack" | "sms" | "voicemail";
  source: "gmail" | "slack" | "ghl";
  fromName: string;
  fromHandle?: string;
  channelLabel: string;
  subject?: string;
  preview: string;
  receivedAt: string;
  isUnread: boolean;
  needsReply: boolean;
  threadId?: string;
  audioUrl?: string;
  durationSec?: number;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SLACK_GATEWAY = "https://connector-gateway.lovable.dev/slack/api";

// ---------- helpers ----------

async function invokeFn(
  fnName: string,
  body: unknown,
  authHeader: string | null,
): Promise<unknown> {
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
  // "Name <email@x.com>" or "email@x.com"
  const m = from.match(/^(.*?)<(.+?)>\s*$/);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, "") || m[2], handle: m[2] };
  return { name: from.trim() || "(unknown)", handle: from.trim() };
}

// ---------- Gmail ----------

async function fetchGmail(authHeader: string | null): Promise<CommMessage[]> {
  if (!authHeader) return [];
  try {
    const list = (await invokeFn(
      "google-gmail",
      { action: "list_messages", params: { maxResults: 15, labelIds: ["INBOX"] } },
      authHeader,
    )) as { messages?: Array<{ id: string; threadId: string }> };
    const ids = (list.messages || []).slice(0, 15).map((m) => m.id);
    if (ids.length === 0) return [];

    const details = await Promise.all(
      ids.map((id) =>
        invokeFn(
          "google-gmail",
          { action: "get_message", params: { id, format: "metadata" } },
          authHeader,
        ).catch((e) => {
          console.warn("[gmail] get_message failed", id, e instanceof Error ? e.message : e);
          return null;
        }),
      ),
    );

    const messages: CommMessage[] = [];
    for (const d of details) {
      if (!d || typeof d !== "object") continue;
      const msg = (d as { message?: unknown }).message as
        | {
            id: string;
            threadId?: string;
            snippet?: string;
            internalDate?: string;
            labelIds?: string[];
            payload?: { headers?: Array<{ name: string; value: string }> };
          }
        | undefined;
      if (!msg) continue;
      const headers = msg.payload?.headers;
      const fromRaw = decodeHeader(headers, "From");
      const subject = decodeHeader(headers, "Subject");
      const { name, handle } = parseFromHeader(fromRaw);
      const ts = msg.internalDate ? Number(msg.internalDate) : Date.now();
      const labels = msg.labelIds || [];
      messages.push({
        id: `gmail:${msg.id}`,
        channel: "email",
        source: "gmail",
        fromName: name,
        fromHandle: handle,
        channelLabel: "Gmail",
        subject: subject || undefined,
        preview: (msg.snippet || "").replace(/\s+/g, " ").trim(),
        receivedAt: new Date(ts).toISOString(),
        isUnread: labels.includes("UNREAD"),
        needsReply: labels.includes("UNREAD") && labels.includes("IMPORTANT"),
        threadId: msg.threadId,
      });
    }
    return messages;
  } catch (e) {
    console.warn("[gmail] aggregate failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

// ---------- Slack ----------

async function slackGateway(
  endpoint: string,
  qs: Record<string, string | number> = {},
): Promise<Record<string, unknown> | null> {
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
  if (!res.ok || (data as { ok?: boolean }).ok === false) {
    console.warn(`[slack] ${endpoint} failed:`, JSON.stringify(data).slice(0, 200));
    return null;
  }
  return data as Record<string, unknown>;
}

async function fetchSlack(): Promise<CommMessage[]> {
  try {
    // Try each channel type independently so a single missing scope (e.g.
    // `groups:read` for private channels) doesn't blank the whole Slack feed.
    const types = ["public_channel", "private_channel", "im", "mpim"];
    const lists = await Promise.all(
      types.map((t) =>
        slackGateway("conversations.list", {
          types: t,
          limit: 8,
          exclude_archived: "true",
        }),
      ),
    );
    const channels = lists.flatMap(
      (l) => ((l?.channels as Array<{ id: string; name?: string; is_im?: boolean; user?: string }>) || []),
    );
    if (channels.length === 0) return [];

    // Build a quick user lookup for IMs (best-effort).
    const userIds = Array.from(new Set(channels.filter((c) => c.is_im && c.user).map((c) => c.user!)));
    const userNames = new Map<string, string>();
    await Promise.all(
      userIds.slice(0, 10).map(async (uid) => {
        const u = await slackGateway("users.info", { user: uid });
        const name =
          (u?.user as { real_name?: string; profile?: { display_name?: string }; name?: string })?.real_name ||
          (u?.user as { profile?: { display_name?: string } })?.profile?.display_name ||
          (u?.user as { name?: string })?.name;
        if (name) userNames.set(uid, name);
      }),
    );

    const perChannel = await Promise.all(
      channels.slice(0, 6).map(async (ch) => {
        const hist = await slackGateway("conversations.history", { channel: ch.id, limit: 3 });
        if (!hist) return [] as CommMessage[];
        const msgs = (hist.messages as Array<{ ts: string; text?: string; user?: string; subtype?: string }>) || [];
        const channelLabel = ch.is_im
          ? `${userNames.get(ch.user || "") || "DM"} · Slack DM`
          : `#${ch.name || "channel"} · Slack`;
        return msgs
          .filter((m) => !m.subtype || m.subtype === "thread_broadcast")
          .map<CommMessage>((m) => ({
            id: `slack:${ch.id}:${m.ts}`,
            channel: "slack",
            source: "slack",
            fromName: ch.is_im ? userNames.get(ch.user || "") || "Slack DM" : `#${ch.name || "channel"}`,
            channelLabel,
            preview: (m.text || "").replace(/\s+/g, " ").slice(0, 240).trim() || "(no text)",
            receivedAt: new Date(Number(m.ts.split(".")[0]) * 1000).toISOString(),
            isUnread: false,
            needsReply: (m.text || "").includes("<@"),
            threadId: ch.id,
          }));
      }),
    );

    return perChannel.flat();
  } catch (e) {
    console.warn("[slack] aggregate failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

// ---------- GHL (SMS + Voicemail) ----------

async function fetchGHL(authHeader: string | null): Promise<CommMessage[]> {
  if (!authHeader) return [];
  try {
    const data = (await invokeFn(
      "gohighlevel",
      { action: "list_conversations", params: { limit: 20 } },
      authHeader,
    )) as { conversations?: Array<Record<string, unknown>> };
    const conversations = data?.conversations || [];
    const messages: CommMessage[] = [];

    for (const c of conversations.slice(0, 20)) {
      const lastMessageType = String(c.lastMessageType || c.type || "TYPE_SMS");
      const isVoicemail = /voicemail|VM/i.test(lastMessageType);
      const isCall = /call/i.test(lastMessageType);
      if (isCall && !isVoicemail) continue; // skip plain calls

      const ts = (c.lastMessageDate || c.dateUpdated || c.dateAdded) as string | number | undefined;
      const receivedAt = ts
        ? new Date(typeof ts === "number" ? ts : Date.parse(String(ts))).toISOString()
        : new Date().toISOString();

      const fromName =
        (c.fullName as string) ||
        (c.contactName as string) ||
        (c.email as string) ||
        (c.phone as string) ||
        "Unknown";

      const preview = String(c.lastMessageBody || c.lastMessage || "").slice(0, 240).trim() || "(new message)";
      const unreadCount = Number(c.unreadCount || 0);

      messages.push({
        id: `ghl:${c.id || c.conversationId}`,
        channel: isVoicemail ? "voicemail" : "sms",
        source: "ghl",
        fromName,
        fromHandle: (c.phone as string) || (c.email as string) || undefined,
        channelLabel: isVoicemail ? "Voicemail" : "SMS",
        preview,
        receivedAt,
        isUnread: unreadCount > 0,
        needsReply: unreadCount > 0,
        threadId: String(c.id || c.conversationId || ""),
      });
    }
    return messages;
  } catch (e) {
    console.warn("[ghl] aggregate failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

// ---------- Priorities ----------

function buildPriorities(stream: CommMessage[]): PriorityItem[] {
  const candidates = stream
    .filter((m) => m.needsReply || m.isUnread)
    .sort((a, b) => +new Date(b.receivedAt) - +new Date(a.receivedAt))
    .slice(0, 3);
  return candidates.map((m, i) => ({
    id: `p${i + 1}`,
    channel: m.channel,
    who: m.fromName.split(/[<·@]/)[0].trim().slice(0, 24) || m.channelLabel,
    what: (m.subject || m.preview).slice(0, 60),
    channelLabel: m.channelLabel.split("·")[0].trim(),
  }));
}

// ---------- handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");

  const [gmail, slack, ghl] = await Promise.all([
    fetchGmail(authHeader),
    fetchSlack(),
    fetchGHL(authHeader),
  ]);

  const stream = [...gmail, ...slack, ...ghl].sort(
    (a, b) => +new Date(b.receivedAt) - +new Date(a.receivedAt),
  );

  const sourceCounts = {
    email: gmail.length,
    slack: slack.length,
    sms: ghl.filter((m) => m.channel === "sms").length,
    voicemail: ghl.filter((m) => m.channel === "voicemail").length,
  };

  return new Response(
    JSON.stringify({
      stream,
      priorities: buildPriorities(stream),
      sourceCounts,
      lastRefreshed: new Date().toISOString(),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
