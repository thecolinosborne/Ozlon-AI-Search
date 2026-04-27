// Auto-ingest pipeline: poll Gmail for new attachments, parse, embed, store.
// Designed to run on a pg_cron schedule (every 15 min by default).
// Iterates users with `email_ingest_state.enabled=true`, fetches new messages
// since the last cursor, extracts text from each attachment via Gemini (binary)
// or direct decoding (text), embeds via OpenAI text-embedding-3-small, and
// upserts into `email_attachments`.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  corsHeaders,
  forceRefreshGoogleToken,
  getGoogleAccessToken,
} from "../_shared/google-token.ts";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_USERS_PER_RUN = 25;
const MAX_MESSAGES_PER_USER = 10;
const MAX_BYTES = 20 * 1024 * 1024;

type AnyJson = Record<string, unknown>;

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function gFetch(userId: string, path: string, retried = false): Promise<AnyJson> {
  const token = await getGoogleAccessToken(userId);
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let data: AnyJson = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const blob = JSON.stringify(data).toLowerCase();
    const recoverable =
      (res.status === 403 && blob.includes("insufficient")) ||
      (res.status === 401 && blob.includes("invalid"));
    if (recoverable && !retried) {
      try { await forceRefreshGoogleToken(userId); } catch (_) { /* fallthrough */ }
      return gFetch(userId, path, true);
    }
    throw new Error(`Gmail ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

function header(headers: AnyJson[], name: string): string {
  const h = headers.find((x) => String((x as AnyJson).name).toLowerCase() === name.toLowerCase());
  return h ? String((h as AnyJson).value || "") : "";
}

function parseSender(from: string): { name: string; email: string } {
  const m = from.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, "").trim(), email: m[2].trim() };
  return { name: from.trim(), email: from.trim() };
}

async function embed(text: string): Promise<number[] | null> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  const input = text.slice(0, 30_000); // model context safety
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.data?.[0]?.embedding ?? null;
  } catch { return null; }
}

async function analyzeBinary(filename: string, mimeType: string, padded: string): Promise<{ text: string; summary: string } | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  const dataUrl = `data:${mimeType};base64,${padded}`;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: `Extract all readable text from "${filename}" then provide a 2-3 sentence summary. Format response as:\n\n===TEXT===\n<full extracted text>\n\n===SUMMARY===\n<concise summary>`,
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        }],
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const content = String(j?.choices?.[0]?.message?.content || "");
    const textMatch = content.match(/===TEXT===\s*([\s\S]*?)\s*===SUMMARY===/);
    const sumMatch = content.match(/===SUMMARY===\s*([\s\S]*)$/);
    return {
      text: (textMatch?.[1] || content).trim(),
      summary: (sumMatch?.[1] || "").trim(),
    };
  } catch { return null; }
}

async function processUser(userId: string, accountEmail: string, lastDate: string | null): Promise<{ processed: number; errors: number }> {
  const db = admin();
  let processed = 0, errors = 0;

  // Build query: messages with attachments since last cursor (default: last 24h)
  const since = lastDate ? Math.floor(new Date(lastDate).getTime() / 1000) : Math.floor((Date.now() - 24 * 3600 * 1000) / 1000);
  const q = encodeURIComponent(`has:attachment after:${since}`);
  let listResp: AnyJson;
  try {
    listResp = await gFetch(userId, `/messages?q=${q}&maxResults=${MAX_MESSAGES_PER_USER}`);
  } catch (e) {
    console.error(`[ingest] list failed user=${userId}:`, e instanceof Error ? e.message : e);
    return { processed: 0, errors: 1 };
  }

  const messages = (listResp.messages as AnyJson[] | undefined) || [];
  let newestDate = lastDate;

  for (const m of messages) {
    const messageId = String(m.id);
    try {
      const msg = await gFetch(userId, `/messages/${encodeURIComponent(messageId)}?format=full`);
      const payload = (msg.payload || {}) as AnyJson;
      const headers = (payload.headers as AnyJson[]) || [];
      const subject = header(headers, "Subject");
      const from = header(headers, "From");
      const dateStr = header(headers, "Date");
      const receivedAt = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();
      const { name: senderName, email: senderEmail } = parseSender(from);
      const threadId = String(msg.threadId || "");

      if (!newestDate || receivedAt > newestDate) newestDate = receivedAt;

      // Walk parts
      type GPart = { filename?: string; mimeType?: string; body?: { attachmentId?: string; size?: number }; parts?: GPart[] };
      const flat: GPart[] = [];
      const walk = (p?: GPart) => { if (!p) return; flat.push(p); (p.parts || []).forEach(walk); };
      walk(payload as GPart);
      const atts = flat.filter((p) => p.filename && p.body?.attachmentId);

      for (const att of atts) {
        const attachmentId = String(att.body?.attachmentId);
        const filename = String(att.filename);
        const mimeType = String(att.mimeType || "application/octet-stream");
        const size = Number(att.body?.size || 0);

        // Skip if exists
        const { data: existing } = await db
          .from("email_attachments")
          .select("id")
          .eq("user_id", userId)
          .eq("message_id", messageId)
          .eq("attachment_id", attachmentId)
          .maybeSingle();
        if (existing) continue;

        // Insert pending row
        const baseRow = {
          user_id: userId,
          account_email: accountEmail,
          message_id: messageId,
          attachment_id: attachmentId,
          thread_id: threadId,
          filename,
          mime_type: mimeType,
          size_bytes: size,
          sender: senderName,
          sender_email: senderEmail,
          subject,
          received_at: receivedAt,
          status: "pending",
        };

        if (size > MAX_BYTES) {
          await db.from("email_attachments").insert({ ...baseRow, status: "skipped", error_message: `${(size/1024/1024).toFixed(1)}MB exceeds 20MB limit` });
          continue;
        }

        try {
          const dl = await gFetch(userId, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
          const dataB64Url = String(dl.data || "");
          if (!dataB64Url) throw new Error("empty attachment data");
          const stdB64 = dataB64Url.replace(/-/g, "+").replace(/_/g, "/");
          const padded = stdB64 + "=".repeat((4 - (stdB64.length % 4)) % 4);

          const lower = (filename + " " + mimeType).toLowerCase();
          const isText = mimeType.startsWith("text/") || /\.(txt|md|csv|tsv|log|json|xml|html?|yaml|yml)$/i.test(filename) || mimeType.includes("json") || mimeType.includes("xml");
          const isPdf = mimeType === "application/pdf" || lower.endsWith(".pdf");
          const isImage = mimeType.startsWith("image/");
          const isOffice = /officedocument|msword|ms-excel|ms-powerpoint/.test(mimeType) || /\.(docx?|xlsx?|pptx?)$/i.test(filename);

          let extractedText = "";
          let summary = "";

          if (isText) {
            try {
              const bin = atob(padded);
              const bytes = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
              extractedText = new TextDecoder("utf-8", { fatal: false }).decode(bytes).slice(0, 200_000);
            } catch (_) { extractedText = ""; }
          } else if (isPdf || isImage || isOffice) {
            const result = await analyzeBinary(filename, mimeType, padded);
            if (result) { extractedText = result.text; summary = result.summary; }
          } else {
            await db.from("email_attachments").insert({ ...baseRow, status: "skipped", error_message: `Unsupported type: ${mimeType}` });
            continue;
          }

          const corpus = `${filename}\n${subject}\nFrom: ${senderName}\n\n${summary}\n\n${extractedText}`.trim();
          const embedding = corpus ? await embed(corpus) : null;

          await db.from("email_attachments").insert({
            ...baseRow,
            extracted_text: extractedText.slice(0, 200_000),
            summary: summary || extractedText.slice(0, 500),
            embedding,
            status: extractedText ? "ingested" : "failed",
            error_message: extractedText ? null : "no text extracted",
          });
          processed++;
        } catch (e) {
          errors++;
          await db.from("email_attachments").insert({ ...baseRow, status: "failed", error_message: e instanceof Error ? e.message : String(e) });
        }
      }
    } catch (e) {
      errors++;
      console.error(`[ingest] message ${messageId} failed:`, e instanceof Error ? e.message : e);
    }
  }

  // Update cursor
  await db
    .from("email_ingest_state")
    .update({ last_polled_at: new Date().toISOString(), last_message_date: newestDate })
    .eq("user_id", userId)
    .eq("account_email", accountEmail);

  return { processed, errors };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const db = admin();
    const { data: states, error } = await db
      .from("email_ingest_state")
      .select("user_id, account_email, last_message_date")
      .eq("enabled", true)
      .order("last_polled_at", { ascending: true, nullsFirst: true })
      .limit(MAX_USERS_PER_RUN);

    if (error) throw error;

    const summary: AnyJson[] = [];
    for (const s of states || []) {
      const result = await processUser(String(s.user_id), String(s.account_email), s.last_message_date as string | null);
      summary.push({ user_id: s.user_id, account: s.account_email, ...result });
    }

    return new Response(JSON.stringify({ ok: true, users: summary.length, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[email-attachments-ingest] fatal:", e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
