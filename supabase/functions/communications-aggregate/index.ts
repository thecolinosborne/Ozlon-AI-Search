// Communications aggregator — fans out to Gmail, Slack, GHL in parallel.
// Each source is best-effort: failures are logged and that source returns []
// so the unified stream still renders. CommMessage shape is identical across
// sources so the frontend renders one feed.

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

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

interface SlackChannel {
  id: string;
  name?: string;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  is_member?: boolean;
  is_archived?: boolean;
  user?: string;
}

interface SlackMessage {
  ts: string;
  text?: string;
  user?: string;
  subtype?: string;
  thread_ts?: string;
  reply_count?: number;
  latest_reply?: string;
}

interface SlackUser {
  id?: string;
  real_name?: string;
  name?: string;
  profile?: { display_name?: string; real_name?: string };
}

// Tracks the most informative Slack failure across calls in a single request.
let slackErrorReason: string | null = null;
let slackErrorScope: string | null = null;

async function getSlackToken(authHeader: string | null): Promise<string | null> {
  const userId = await getUserId(authHeader);
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!userId || !SERVICE_KEY) return null;

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data } = await admin
      .from("integration_connections")
      .select("metadata")
      .eq("user_id", userId)
      .eq("provider", "slack")
      .eq("status", "connected")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return String((data?.metadata as { access_token?: string } | null)?.access_token || "") || null;
  } catch (e) {
    console.warn("[slack] token lookup failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function slackGateway(
  endpoint: string,
  qs: Record<string, string | number> = {},
  authHeader: string | null,
  userToken: string | null,
): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(qs)) params.set(k, String(v));

  try {
    let res: Response;

    if (userToken) {
      const url = `https://slack.com/api/${endpoint}${params.toString() ? `?${params}` : ""}`;
      res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
      });
    } else {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      const SLACK_API_KEY = Deno.env.get("SLACK_API_KEY");
      if (!LOVABLE_API_KEY || !SLACK_API_KEY) return null;
      const url = `${SLACK_GATEWAY}/${endpoint}${params.toString() ? `?${params}` : ""}`;
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "X-Connection-Api-Key": SLACK_API_KEY,
        },
      });
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data as { ok?: boolean }).ok === false) {
      const detail = JSON.stringify(data).slice(0, 300);
      const errStr = String((data as { error?: string }).error || detail || "error");
      const needed = String((data as { needed?: string }).needed || "");
      if (errStr === "missing_scope" || errStr.includes("missing_scope")) {
        if (!slackErrorReason || slackErrorReason !== "missing_scope") {
          slackErrorReason = "missing_scope";
          slackErrorScope = needed || slackErrorScope;
        }
      } else if (!slackErrorReason) {
        slackErrorReason = errStr || "error";
      }
      console.warn(`[slack] ${endpoint} failed:`, detail);
      return null;
    }

    return data as Record<string, unknown>;
  } catch (e) {
    if (!slackErrorReason) slackErrorReason = "error";
    console.warn(`[slack] ${endpoint} threw:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// Paginate conversations.list for a single type up to a budget.
async function listChannelsForType(
  type: string,
  budget: number,
  authHeader: string | null,
  userToken: string | null,
): Promise<SlackChannel[]> {
  const out: SlackChannel[] = [];
  let cursor = "";
  for (let i = 0; i < 6 && out.length < budget; i++) {
    const qs: Record<string, string | number> = {
      types: type,
      limit: Math.min(200, budget * 2),
      exclude_archived: "true",
    };
    if (cursor) qs.cursor = cursor;
    const data = await slackGateway("conversations.list", qs, authHeader, userToken);
    if (!data) break;
    const channels = (data.channels as SlackChannel[]) || [];
    for (const c of channels) {
      if (c.is_archived) continue;
      out.push(c);
      if (out.length >= budget) break;
    }
    cursor =
      ((data.response_metadata as { next_cursor?: string } | undefined)?.next_cursor) || "";
    if (!cursor) break;
  }
  return out;
}

const SLACK_TIMEOUT_MS = 8000;
const PER_TYPE_BUDGETS: Record<string, number> = {
  im: 25,
  mpim: 10,
  private_channel: 15,
  public_channel: 10,
};
const HISTORY_LIMIT = 15;

function fmtUser(u: SlackUser | undefined): string | undefined {
  if (!u) return undefined;
  return (
    u.profile?.display_name ||
    u.real_name ||
    u.profile?.real_name ||
    u.name ||
    undefined
  );
}

interface SlackResult {
  messages: CommMessage[];
  partial: boolean;
  reason?: string;
  scope?: string;
}

async function fetchSlackInner(authHeader: string | null): Promise<SlackResult> {
  slackErrorReason = null;
  slackErrorScope = null;

  const userToken = await getSlackToken(authHeader);
  const auth = await slackGateway("auth.test", {}, authHeader, userToken);
  const myUserId =
    (auth?.user_id as string | undefined) || (auth?.bot_id as string | undefined) || "";

  const typeEntries = Object.entries(PER_TYPE_BUDGETS);
  const channelLists = await Promise.all(
    typeEntries.map(([t, b]) => listChannelsForType(t, b, authHeader, userToken)),
  );
  let channels: SlackChannel[] = channelLists.flat();
  if (channels.length === 0) return { messages: [], partial: false };

  channels = channels.filter((c) => {
    if (c.is_im || c.is_mpim || c.is_private) return true;
    return c.is_member === true;
  });

  const perChannel = await Promise.all(
    channels.map(async (ch) => {
      const [info, hist] = await Promise.all([
        slackGateway("conversations.info", { channel: ch.id }, authHeader, userToken),
        slackGateway(
          "conversations.history",
          { channel: ch.id, limit: HISTORY_LIMIT },
          authHeader,
          userToken,
        ),
      ]);
      if (!hist) return { ch, msgs: [] as SlackMessage[], lastRead: 0 };
      const lastReadStr =
        ((info?.channel as { last_read?: string } | undefined)?.last_read) || "0";
      const lastRead = Number(lastReadStr) || 0;
      const msgs = (hist.messages as SlackMessage[]) || [];
      return { ch, msgs, lastRead };
    }),
  );

  await Promise.all(
    perChannel.map(async (entry) => {
      const extras: SlackMessage[] = [];
      for (const m of entry.msgs) {
        if (
          (m.reply_count || 0) > 0 &&
          m.latest_reply &&
          Number(m.latest_reply) > entry.lastRead
        ) {
          const replies = await slackGateway(
            "conversations.replies",
            {
              channel: entry.ch.id,
              ts: m.ts,
              limit: 10,
            },
            authHeader,
            userToken,
          );
          if (replies) {
            const rs = (replies.messages as SlackMessage[]) || [];
            for (const r of rs) {
              if (r.ts === m.ts) continue;
              if (Number(r.ts) > entry.lastRead) extras.push(r);
            }
          }
        }
      }
      entry.msgs = entry.msgs.concat(extras);
    }),
  );

  const allUserIds = new Set<string>();
  for (const entry of perChannel) {
    if (entry.ch.user) allUserIds.add(entry.ch.user);
    for (const m of entry.msgs) {
      if (m.user) allUserIds.add(m.user);
    }
  }
  const userMap = new Map<string, SlackUser>();
  const userIdList = Array.from(allUserIds).slice(0, 200);
  await Promise.all(
    userIdList.map(async (uid) => {
      const u = await slackGateway("users.info", { user: uid }, authHeader, userToken);
      const userObj = u?.user as SlackUser | undefined;
      if (userObj) userMap.set(uid, userObj);
    }),
  );

  const out: CommMessage[] = [];
  for (const entry of perChannel) {
    const ch = entry.ch;
    const dmPartnerName =
      ch.is_im && ch.user ? fmtUser(userMap.get(ch.user)) : undefined;
    const channelLabel = ch.is_im
      ? `${dmPartnerName || "DM"} · Slack DM`
      : ch.is_mpim
        ? "Group DM · Slack"
        : `#${ch.name || "channel"} · Slack`;

    for (const m of entry.msgs) {
      if (m.subtype && m.subtype !== "thread_broadcast") continue;
      const text = m.text || "";
      const isUnread = Number(m.ts) > entry.lastRead;
      const isMention = !!myUserId && text.includes(`<@${myUserId}>`);
      const isDmFromOther = !!ch.is_im && !!m.user && m.user !== myUserId;
      const needsReply = isUnread && (isMention || isDmFromOther);

      const senderName =
        (m.user && fmtUser(userMap.get(m.user))) ||
        (ch.is_im ? dmPartnerName || "Slack DM" : `#${ch.name || "channel"}`);

      let resolvedText = text.replace(/<@([UW][A-Z0-9]+)>/g, (_, uid) => {
        const n = fmtUser(userMap.get(uid));
        return n ? `@${n}` : "@user";
      });
      resolvedText = resolvedText.replace(
        /<(https?:\/\/[^|>\s]+)(?:\|([^>]+))?>/g,
        (_full, url, label) => label || url,
      );

      out.push({
        id: `slack:${ch.id}:${m.ts}`,
        channel: "slack",
        source: "slack",
        fromName: senderName,
        channelLabel,
        preview:
          resolvedText.replace(/\s+/g, " ").slice(0, 240).trim() || "(no text)",
        receivedAt: new Date(Number(m.ts.split(".")[0]) * 1000).toISOString(),
        isUnread,
        needsReply,
        threadId: m.thread_ts || ch.id,
      });
    }
  }

  const partial = !!slackErrorReason;
  return {
    messages: out,
    partial,
    reason: slackErrorReason ?? undefined,
    scope: slackErrorScope ?? undefined,
  };
}

async function fetchSlack(authHeader: string | null): Promise<SlackResult> {
  try {
    return await Promise.race<SlackResult>([
      fetchSlackInner(authHeader),
      new Promise<SlackResult>((resolve) =>
        setTimeout(
          () => resolve({ messages: [], partial: true, reason: "timeout" }),
          SLACK_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (e) {
    console.warn("[slack] aggregate failed:", e instanceof Error ? e.message : e);
    return { messages: [], partial: true, reason: "error" };
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

// ---------- Cache write ----------

async function getUserId(authHeader: string | null): Promise<string | null> {
  if (!authHeader) return null;
  const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data } = await sb.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

async function persistMessages(userId: string, stream: CommMessage[]) {
  if (!userId || stream.length === 0) return;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SERVICE_KEY) return;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const rows = stream.map((m) => {
    const externalId = m.id.replace(/^[a-z]+:/, "");
    return {
      user_id: userId,
      source: m.source,
      channel: m.channel,
      external_id: externalId,
      thread_external_id: m.threadId ?? null,
      from_name: m.fromName,
      from_handle: m.fromHandle ?? null,
      channel_label: m.channelLabel,
      subject: m.subject ?? null,
      preview: m.preview,
      body_text: m.preview, // B2 will replace with full body
      audio_url: m.audioUrl ?? null,
      duration_sec: m.durationSec ?? null,
      received_at: m.receivedAt,
      is_unread: m.isUnread,
      needs_reply: m.needsReply,
      raw: {} as Record<string, unknown>,
      fetched_at: new Date().toISOString(),
    };
  });
  // Chunk to keep payloads sane.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await admin
      .from("communications_messages")
      .upsert(slice, { onConflict: "user_id,source,external_id" });
    if (error) {
      console.warn("[cache] upsert failed:", error.message);
      break;
    }
  }
}

// ---------- handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");

  const [gmail, slack, ghl, userId] = await Promise.all([
    fetchGmail(authHeader),
    fetchSlack(),
    fetchGHL(authHeader),
    getUserId(authHeader),
  ]);

  const slackMessages = slack.messages;
  const stream = [...gmail, ...slackMessages, ...ghl].sort(
    (a, b) => +new Date(b.receivedAt) - +new Date(a.receivedAt),
  );

  const sourceCounts = {
    email: gmail.length,
    slack: slackMessages.length,
    sms: ghl.filter((m) => m.channel === "sms").length,
    voicemail: ghl.filter((m) => m.channel === "voicemail").length,
  };

  const priorities = buildPriorities(stream);
  const lastRefreshed = new Date().toISOString();

  // Fire-and-forget cache write (does not block response).
  if (userId) {
    persistMessages(userId, stream).catch((e) =>
      console.warn("[cache] persist threw:", e instanceof Error ? e.message : e),
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      data: { stream, priorities, sourceCounts, lastRefreshed },
      diagnostics: {
        partial: slack.partial,
        slackReason: slack.reason ?? null,
        slackScope: slack.scope ?? null,
        sources: sourceCounts,
      },
      // legacy mirrors — safe to remove after one release cycle
      stream,
      priorities,
      sourceCounts,
      partial: {
        slack: slack.partial,
        slackReason: slack.reason ?? null,
        slackScope: slack.scope ?? null,
      },
      lastRefreshed,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
