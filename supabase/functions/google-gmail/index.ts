import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  forceRefreshGoogleToken,
  getAuthedUserId,
  getGoogleAccessToken,
  jsonErr,
  jsonOk,
} from "../_shared/google-token.ts";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

type AnyJson = Record<string, unknown>;

// Auto-recovery: on 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT (or 401 invalid_token),
// force-refresh the OAuth token once and retry. This makes newly granted
// Gmail scopes take effect on the very next call after the user reauthorizes.
async function gFetch(
  userId: string,
  path: string,
  init: RequestInit = {},
  _retried = false,
): Promise<AnyJson> {
  const token = await getGoogleAccessToken(userId);
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const blob = JSON.stringify(data).toLowerCase();
    const isScopeIssue =
      res.status === 403 &&
      (blob.includes("access_token_scope_insufficient") ||
        blob.includes("insufficient authentication scopes") ||
        blob.includes("insufficient permission"));
    const isAuthExpired =
      res.status === 401 &&
      (blob.includes("invalid_token") || blob.includes("invalid credentials"));

    if ((isScopeIssue || isAuthExpired) && !_retried) {
      console.log(`[google-gmail] auth recovery: status=${res.status} forcing token refresh and retrying once`);
      try {
        await forceRefreshGoogleToken(userId);
      } catch (refreshErr) {
        const m = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
        throw new Error(
          `Gmail API ${res.status}: ${JSON.stringify(data)} — token refresh failed: ${m}. Please reconnect Google in Integrations.`,
        );
      }
      return gFetch(userId, path, init, true);
    }
    throw new Error(`Gmail API ${res.status}: ${JSON.stringify(data)}`);
  }
  return (data ?? {}) as AnyJson;
}

function buildRawEmail(
  headers: Record<string, string>,
  body: string,
  opts: { html?: string; inReplyTo?: string; references?: string } = {},
): string {
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  if (opts.inReplyTo) {
    lines.push(`In-Reply-To: ${opts.inReplyTo}`);
    lines.push(`References: ${opts.references || opts.inReplyTo}`);
  }
  if (opts.html) {
    const boundary = `=_alt_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    lines.push("MIME-Version: 1.0");
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push("", `--${boundary}`);
    lines.push("Content-Type: text/plain; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 7bit", "", body);
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/html; charset=UTF-8");
    lines.push("Content-Transfer-Encoding: 7bit", "", opts.html);
    lines.push(`--${boundary}--`);
  } else {
    lines.push("Content-Type: text/plain; charset=UTF-8", "", body);
  }
  const raw = lines.join("\r\n");
  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Build a multipart/mixed RFC822 message with one or more attachments.
// attachments: [{ filename, mimeType, dataBase64 }]
function buildRawEmailWithAttachments(
  headers: Record<string, string>,
  body: string,
  attachments: Array<{ filename: string; mimeType: string; dataBase64: string }>,
): string {
  const boundary = `=_ozlon_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const head: string[] = [];
  for (const [k, v] of Object.entries(headers)) head.push(`${k}: ${v}`);
  head.push("MIME-Version: 1.0");
  head.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  head.push("");
  const parts: string[] = [];
  // text body part
  parts.push(`--${boundary}`);
  parts.push("Content-Type: text/plain; charset=UTF-8");
  parts.push("Content-Transfer-Encoding: 7bit");
  parts.push("");
  parts.push(body);
  // attachments
  for (const att of attachments) {
    parts.push(`--${boundary}`);
    parts.push(`Content-Type: ${att.mimeType}; name="${att.filename}"`);
    parts.push("Content-Transfer-Encoding: base64");
    parts.push(`Content-Disposition: attachment; filename="${att.filename}"`);
    parts.push("");
    // wrap base64 at 76 chars per RFC
    parts.push(att.dataBase64.replace(/(.{76})/g, "$1\r\n"));
  }
  parts.push(`--${boundary}--`);
  const raw = head.join("\r\n") + parts.join("\r\n");
  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await getAuthedUserId(req);
    const { action, params = {} } = (await req.json()) as { action: string; params?: AnyJson };
    if (!action) return jsonErr("Missing action");

    switch (action) {
      // ── Existing ──
      case "list_messages": {
        const q = String((params as AnyJson).q || "");
        const maxResults = Number((params as AnyJson).maxResults || 20);
        const labelIds = (params as AnyJson).labelIds as string[] | undefined;
        const pageToken = String((params as AnyJson).pageToken || "");
        const qs = new URLSearchParams();
        qs.set("maxResults", String(Math.min(100, Math.max(1, maxResults))));
        if (q) qs.set("q", q);
        if (labelIds && labelIds.length) qs.set("labelIds", labelIds.join(","));
        if (pageToken) qs.set("pageToken", pageToken);
        const data = await gFetch(userId, `/messages?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      case "get_message": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const format = String((params as AnyJson).format || "full");
        const data = await gFetch(userId, `/messages/${encodeURIComponent(id)}?format=${format}`);
        return jsonOk({ success: true, message: data });
      }

      case "send_message": {
        const to = String((params as AnyJson).to || "");
        const subject = String((params as AnyJson).subject || "");
        const body = String((params as AnyJson).body || "");
        const html = (params as AnyJson).body_html as string | undefined;
        const cc = String((params as AnyJson).cc || "");
        const bcc = String((params as AnyJson).bcc || "");
        const inReplyTo = (params as AnyJson).inReplyTo as string | undefined;
        const references = (params as AnyJson).references as string | undefined;
        const threadId = (params as AnyJson).threadId as string | undefined;
        if (!to || !subject) return jsonErr("to and subject are required");

        const hdrs: Record<string, string> = { To: to, Subject: subject };
        if (cc) hdrs["Cc"] = cc;
        if (bcc) hdrs["Bcc"] = bcc;

        const raw = buildRawEmail(hdrs, body, { html, inReplyTo, references });
        const sendBody: AnyJson = { raw };
        if (threadId) sendBody.threadId = threadId;
        const data = await gFetch(userId, "/messages/send", {
          method: "POST",
          body: JSON.stringify(sendBody),
        });
        return jsonOk({ success: true, message: data });
      }

      case "trash_message": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(userId, `/messages/${encodeURIComponent(id)}/trash`, { method: "POST" });
        return jsonOk({ success: true, message: data });
      }

      case "list_labels": {
        const data = await gFetch(userId, "/labels");
        return jsonOk({ success: true, ...data });
      }

      // ── New actions ──
      case "untrash_message": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(userId, `/messages/${encodeURIComponent(id)}/untrash`, { method: "POST" });
        return jsonOk({ success: true, message: data });
      }

      case "modify_message": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const addLabelIds = (params as AnyJson).addLabelIds as string[] | undefined;
        const removeLabelIds = (params as AnyJson).removeLabelIds as string[] | undefined;
        const data = await gFetch(userId, `/messages/${encodeURIComponent(id)}/modify`, {
          method: "POST",
          body: JSON.stringify({ addLabelIds: addLabelIds || [], removeLabelIds: removeLabelIds || [] }),
        });
        return jsonOk({ success: true, message: data });
      }

      case "list_threads": {
        const q = String((params as AnyJson).q || "");
        const maxResults = Number((params as AnyJson).maxResults || 20);
        const pageToken = String((params as AnyJson).pageToken || "");
        const qs = new URLSearchParams();
        qs.set("maxResults", String(Math.min(100, Math.max(1, maxResults))));
        if (q) qs.set("q", q);
        if (pageToken) qs.set("pageToken", pageToken);
        const data = await gFetch(userId, `/threads?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      case "get_thread": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const format = String((params as AnyJson).format || "full");
        const data = await gFetch(userId, `/threads/${encodeURIComponent(id)}?format=${format}`);
        return jsonOk({ success: true, thread: data });
      }

      case "create_draft": {
        const to = String((params as AnyJson).to || "");
        const subject = String((params as AnyJson).subject || "");
        const body = String((params as AnyJson).body || "");
        const threadId = String((params as AnyJson).threadId || "");
        const hdrs: Record<string, string> = { To: to, Subject: subject };
        const raw = buildRawEmail(hdrs, body);
        const draftBody: AnyJson = { message: { raw } };
        if (threadId) (draftBody.message as AnyJson).threadId = threadId;
        const data = await gFetch(userId, "/drafts", { method: "POST", body: JSON.stringify(draftBody) });
        return jsonOk({ success: true, draft: data });
      }

      case "list_drafts": {
        const maxResults = Number((params as AnyJson).maxResults || 20);
        const pageToken = String((params as AnyJson).pageToken || "");
        const qs = new URLSearchParams();
        qs.set("maxResults", String(Math.min(100, Math.max(1, maxResults))));
        if (pageToken) qs.set("pageToken", pageToken);
        const data = await gFetch(userId, `/drafts?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      case "send_draft": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(userId, "/drafts/send", {
          method: "POST",
          body: JSON.stringify({ id }),
        });
        return jsonOk({ success: true, message: data });
      }

      case "delete_draft": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        await gFetch(userId, `/drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
        return jsonOk({ success: true });
      }

      case "reply_message": {
        const messageId = String((params as AnyJson).messageId || "");
        const threadId = String((params as AnyJson).threadId || "");
        const to = String((params as AnyJson).to || "");
        const subject = String((params as AnyJson).subject || "");
        const body = String((params as AnyJson).body || "");
        if (!to || !body) return jsonErr("to and body are required");

        const hdrs: Record<string, string> = { To: to, Subject: subject || "Re:" };
        if (messageId) {
          hdrs["In-Reply-To"] = messageId;
          hdrs["References"] = messageId;
        }
        const raw = buildRawEmail(hdrs, body);
        const msgBody: AnyJson = { raw };
        if (threadId) msgBody.threadId = threadId;
        const data = await gFetch(userId, "/messages/send", { method: "POST", body: JSON.stringify(msgBody) });
        return jsonOk({ success: true, message: data });
      }

      case "search_messages": {
        const q = String((params as AnyJson).q || "");
        if (!q) return jsonErr("q (search query) is required");
        const maxResults = Number((params as AnyJson).maxResults || 25);
        const pageToken = String((params as AnyJson).pageToken || "");
        const qs = new URLSearchParams();
        qs.set("q", q);
        qs.set("maxResults", String(Math.min(100, Math.max(1, maxResults))));
        if (pageToken) qs.set("pageToken", pageToken);
        const data = await gFetch(userId, `/messages?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      case "get_profile": {
        const data = await gFetch(userId, "/profile");
        return jsonOk({ success: true, profile: data });
      }

      case "batch_modify": {
        const ids = (params as AnyJson).ids as string[] | undefined;
        if (!ids || !ids.length) return jsonErr("ids array is required");
        const addLabelIds = (params as AnyJson).addLabelIds as string[] | undefined;
        const removeLabelIds = (params as AnyJson).removeLabelIds as string[] | undefined;
        const data = await gFetch(userId, "/messages/batchModify", {
          method: "POST",
          body: JSON.stringify({ ids, addLabelIds: addLabelIds || [], removeLabelIds: removeLabelIds || [] }),
        });
        return jsonOk({ success: true, ...data as AnyJson });
      }

      case "list_history": {
        const startHistoryId = String((params as AnyJson).startHistoryId || "");
        if (!startHistoryId) return jsonErr("startHistoryId is required");
        const maxResults = Number((params as AnyJson).maxResults || 100);
        const qs = new URLSearchParams();
        qs.set("startHistoryId", startHistoryId);
        qs.set("maxResults", String(Math.min(500, Math.max(1, maxResults))));
        const data = await gFetch(userId, `/history?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      // ── Tier 1: Filters ──
      case "list_filters": {
        const data = await gFetch(userId, "/settings/filters");
        return jsonOk({ success: true, ...(data as AnyJson) });
      }

      case "create_filter": {
        const criteria = (params as AnyJson).criteria as AnyJson | undefined;
        const action = (params as AnyJson).action as AnyJson | undefined;
        if (!criteria || !action) return jsonErr("criteria and action are required");
        const data = await gFetch(userId, "/settings/filters", {
          method: "POST",
          body: JSON.stringify({ criteria, action }),
        });
        return jsonOk({ success: true, filter: data });
      }

      case "delete_filter": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        await gFetch(userId, `/settings/filters/${encodeURIComponent(id)}`, { method: "DELETE" });
        return jsonOk({ success: true });
      }

      case "get_filter": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(userId, `/settings/filters/${encodeURIComponent(id)}`);
        return jsonOk({ success: true, filter: data });
      }

      // ── Tier 1: Vacation / Vacation Responder ──
      case "get_vacation": {
        const data = await gFetch(userId, "/settings/vacation");
        return jsonOk({ success: true, vacation: data });
      }

      case "update_vacation": {
        const enableAutoReply = Boolean((params as AnyJson).enableAutoReply);
        const responseSubject = String((params as AnyJson).responseSubject || "");
        const responseBodyPlainText = String((params as AnyJson).responseBodyPlainText || "");
        const restrictToContacts = Boolean((params as AnyJson).restrictToContacts || false);
        const restrictToDomain = Boolean((params as AnyJson).restrictToDomain || false);
        const startTime = (params as AnyJson).startTime as number | undefined;
        const endTime = (params as AnyJson).endTime as number | undefined;
        const body: AnyJson = {
          enableAutoReply,
          responseSubject,
          responseBodyPlainText,
          restrictToContacts,
          restrictToDomain,
        };
        if (startTime) body.startTime = startTime;
        if (endTime) body.endTime = endTime;
        const data = await gFetch(userId, "/settings/vacation", {
          method: "PUT",
          body: JSON.stringify(body),
        });
        return jsonOk({ success: true, vacation: data });
      }

      // ── Tier 1: SendAs / Signatures ──
      case "list_send_as": {
        const data = await gFetch(userId, "/settings/sendAs");
        return jsonOk({ success: true, ...(data as AnyJson) });
      }

      case "update_signature": {
        const sendAsEmail = String((params as AnyJson).sendAsEmail || "");
        const signature = String((params as AnyJson).signature || "");
        if (!sendAsEmail) return jsonErr("sendAsEmail is required");
        const data = await gFetch(
          userId,
          `/settings/sendAs/${encodeURIComponent(sendAsEmail)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ signature }),
          },
        );
        return jsonOk({ success: true, sendAs: data });
      }

      // ── Tier 1: Forward ──
      case "forward_message": {
        const to = String((params as AnyJson).to || "");
        const subject = String((params as AnyJson).subject || "");
        const body = String((params as AnyJson).body || "");
        const originalMessageId = String((params as AnyJson).originalMessageId || "");
        if (!to) return jsonErr("to is required");
        const hdrs: Record<string, string> = {
          To: to,
          Subject: subject || "Fwd:",
        };
        if (originalMessageId) hdrs["References"] = originalMessageId;
        const raw = buildRawEmail(hdrs, body);
        const data = await gFetch(userId, "/messages/send", {
          method: "POST",
          body: JSON.stringify({ raw }),
        });
        return jsonOk({ success: true, message: data });
      }

      // ── Tier 1: List attachments on a single message ──
      case "list_attachments": {
        const messageId = String((params as AnyJson).messageId || "");
        if (!messageId) return jsonErr("messageId is required");
        const msg = await gFetch(
          userId,
          `/messages/${encodeURIComponent(messageId)}?format=full`,
        );
        type GPart = {
          filename?: string;
          mimeType?: string;
          body?: { attachmentId?: string; size?: number };
          headers?: Array<{ name?: string; value?: string }>;
          parts?: GPart[];
        };
        const flat: GPart[] = [];
        const walk = (p?: GPart) => {
          if (!p) return;
          flat.push(p);
          (p.parts || []).forEach(walk);
        };
        walk((msg as { payload?: GPart }).payload);
        const attachments = flat
          .filter((p) => p.filename && p.body?.attachmentId)
          .map((p) => {
            const cd = (p.headers || []).find(
              (h) => (h.name || "").toLowerCase() === "content-disposition",
            )?.value || "";
            return {
              attachmentId: p.body!.attachmentId,
              filename: p.filename,
              mimeType: p.mimeType || "application/octet-stream",
              sizeBytes: Number(p.body?.size || 0),
              inline: /inline/i.test(cd),
            };
          });
        return jsonOk({ success: true, messageId, count: attachments.length, attachments });
      }

      // ── Tier 1: List attachments across every message in a thread ──
      case "list_thread_attachments": {
        const threadId = String((params as AnyJson).threadId || "");
        if (!threadId) return jsonErr("threadId is required");
        const thread = await gFetch(
          userId,
          `/threads/${encodeURIComponent(threadId)}?format=full`,
        );
        type GPart = {
          filename?: string;
          mimeType?: string;
          body?: { attachmentId?: string; size?: number };
          parts?: GPart[];
        };
        type GMsg = {
          id?: string;
          internalDate?: string;
          payload?: { headers?: Array<{ name?: string; value?: string }> } & GPart;
        };
        const out: AnyJson[] = [];
        for (const m of ((thread as { messages?: GMsg[] }).messages || [])) {
          const headers = m.payload?.headers || [];
          const hdr = (n: string) =>
            headers.find((h) => (h.name || "").toLowerCase() === n.toLowerCase())?.value || "";
          const flat: GPart[] = [];
          const walk = (p?: GPart) => {
            if (!p) return;
            flat.push(p);
            (p.parts || []).forEach(walk);
          };
          walk(m.payload);
          for (const p of flat) {
            if (!p.filename || !p.body?.attachmentId) continue;
            out.push({
              messageId: m.id,
              internalDate: m.internalDate,
              from: hdr("From"),
              subject: hdr("Subject"),
              attachmentId: p.body.attachmentId,
              filename: p.filename,
              mimeType: p.mimeType || "application/octet-stream",
              sizeBytes: Number(p.body?.size || 0),
            });
          }
        }
        return jsonOk({ success: true, threadId, count: out.length, attachments: out });
      }

      // ── Tier 1: Attachments ──
      case "get_attachment": {
        const messageId = String((params as AnyJson).messageId || "");
        const attachmentId = String((params as AnyJson).attachmentId || "");
        if (!messageId || !attachmentId) return jsonErr("messageId and attachmentId are required");
        const data = await gFetch(
          userId,
          `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
        );
        return jsonOk({ success: true, attachment: data });
      }

      // ── Tier 1: Analyze Attachment (extract content + AI analysis) ──
      case "analyze_attachment": {
        const messageId = String((params as AnyJson).messageId || "");
        let attachmentId = String((params as AnyJson).attachmentId || "");
        const filenameHint = String((params as AnyJson).filename || "").toLowerCase();
        const question = String((params as AnyJson).question || "").trim();
        if (!messageId) return jsonErr("messageId is required");

        // Resolve attachment metadata (mimeType, filename) from the message
        // payload. If attachmentId is missing, locate it by filename hint or
        // pick the first non-inline attachment.
        let mimeType = "";
        let filename = "";
        try {
          const msg = await gFetch(
            userId,
            `/messages/${encodeURIComponent(messageId)}?format=full`,
          );
          type GPart = {
            filename?: string;
            mimeType?: string;
            body?: { attachmentId?: string };
            parts?: GPart[];
          };
          const flat: GPart[] = [];
          const walk = (p?: GPart) => {
            if (!p) return;
            flat.push(p);
            (p.parts || []).forEach(walk);
          };
          walk((msg as { payload?: GPart }).payload);
          const candidates = flat.filter(
            (p) => p.filename && p.body?.attachmentId,
          );
          let match: GPart | undefined;
          if (attachmentId) {
            match = candidates.find((p) => p.body?.attachmentId === attachmentId);
          } else if (filenameHint) {
            match = candidates.find((p) =>
              (p.filename || "").toLowerCase().includes(filenameHint)
            );
          }
          if (!match) match = candidates[0];
          if (!match) {
            return jsonErr(
              `No downloadable attachments found on message ${messageId}.`,
              404,
            );
          }
          attachmentId = String(match.body?.attachmentId || "");
          mimeType = String(match.mimeType || "application/octet-stream");
          filename = String(match.filename || "attachment");
        } catch (e) {
          return jsonErr(
            `Failed to resolve attachment on message ${messageId}: ${
              e instanceof Error ? e.message : String(e)
            }`,
            502,
          );
        }

        // Download the binary
        let dataB64Url = "";
        let sizeBytes = 0;
        try {
          const att = await gFetch(
            userId,
            `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
          );
          dataB64Url = String((att as AnyJson).data || "");
          sizeBytes = Number((att as AnyJson).size || 0);
        } catch (e) {
          return jsonErr(
            `Failed to download attachment: ${
              e instanceof Error ? e.message : String(e)
            }`,
            502,
          );
        }

        if (sizeBytes > 20 * 1024 * 1024) {
          return jsonErr(
            `Attachment "${filename}" is ${(sizeBytes / 1024 / 1024).toFixed(1)}MB — exceeds 20MB analysis limit.`,
            413,
          );
        }
        if (!dataB64Url) {
          return jsonErr("Empty attachment data returned from Gmail.", 502);
        }

        // Convert Gmail base64url → standard base64
        const stdB64 = dataB64Url.replace(/-/g, "+").replace(/_/g, "/");
        const padded = stdB64 + "=".repeat((4 - (stdB64.length % 4)) % 4);

        // Helper: decode base64 → utf8 text
        const decodeText = (): string => {
          try {
            const bin = atob(padded);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          } catch {
            return "";
          }
        };

        const lower = (filename + " " + mimeType).toLowerCase();
        const isPlainText =
          mimeType.startsWith("text/") ||
          /\.(txt|md|csv|tsv|log|json|xml|html?|yaml|yml)$/i.test(filename) ||
          mimeType.includes("json") ||
          mimeType.includes("xml");
        const isPdf = mimeType === "application/pdf" || lower.endsWith(".pdf");
        const isImage = mimeType.startsWith("image/");
        const isOffice =
          /officedocument|msword|ms-excel|ms-powerpoint/.test(mimeType) ||
          /\.(docx?|xlsx?|pptx?)$/i.test(filename);

        // Plain text: return directly so the caller LLM can reason on it
        if (isPlainText) {
          const text = decodeText();
          const truncated = text.slice(0, 200_000);
          return jsonOk({
            success: true,
            filename,
            mimeType,
            sizeBytes,
            kind: "text",
            content: truncated,
            truncated: text.length > truncated.length,
          });
        }

        // PDFs / images / office docs → send to Gemini via Lovable AI Gateway
        if (isPdf || isImage || isOffice) {
          const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
          if (!LOVABLE_API_KEY) {
            return jsonErr(
              "LOVABLE_API_KEY not configured — cannot analyze binary attachments.",
              500,
            );
          }
          const analysisPrompt = question
            ? `Analyze the attached file "${filename}" and answer this specific question:\n\n${question}\n\nQuote relevant text verbatim where it supports the answer.`
            : `Extract all readable text from "${filename}" and provide a structured summary. Include: (1) document type, (2) key facts/figures/dates/parties, (3) any tables as markdown, (4) action items if applicable. Preserve numeric values exactly.`;

          // Gemini accepts PDFs and images as inline_data; for unsupported
          // office formats we still try — Gemini 2.5 handles many.
          const dataUrl = `data:${mimeType};base64,${padded}`;
          try {
            const aiRes = await fetch(
              "https://ai.gateway.lovable.dev/v1/chat/completions",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${LOVABLE_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: "google/gemini-2.5-flash",
                  messages: [
                    {
                      role: "user",
                      content: [
                        { type: "text", text: analysisPrompt },
                        { type: "image_url", image_url: { url: dataUrl } },
                      ],
                    },
                  ],
                }),
              },
            );
            const aiText = await aiRes.text();
            let aiData: AnyJson;
            try {
              aiData = JSON.parse(aiText);
            } catch {
              aiData = { raw: aiText };
            }
            if (!aiRes.ok) {
              if (aiRes.status === 429) {
                return jsonErr(
                  "AI rate limit hit while analyzing attachment. Please retry in a moment.",
                  429,
                );
              }
              if (aiRes.status === 402) {
                return jsonErr(
                  "AI credits exhausted. Add funds in Settings → Workspace → Usage.",
                  402,
                );
              }
              return jsonErr(
                `AI analysis failed [${aiRes.status}]: ${JSON.stringify(aiData).slice(0, 500)}`,
                502,
              );
            }
            const analysis = String(
              ((aiData as AnyJson).choices as AnyJson[] | undefined)?.[0]
                ? ((((aiData as AnyJson).choices as AnyJson[])[0] as AnyJson)
                  .message as AnyJson)?.content || ""
                : "",
            );
            return jsonOk({
              success: true,
              filename,
              mimeType,
              sizeBytes,
              kind: isPdf ? "pdf" : isImage ? "image" : "office",
              analysis,
              question: question || null,
            });
          } catch (e) {
            return jsonErr(
              `AI analysis crashed: ${e instanceof Error ? e.message : String(e)}`,
              502,
            );
          }
        }

        // Unsupported binary
        return jsonErr(
          `Cannot analyze "${filename}" (${mimeType}) — unsupported file type. Supported: PDF, DOCX, XLSX, PPTX, images, plain text/CSV/JSON.`,
          415,
        );
      }

      case "send_with_attachment": {
        const to = String((params as AnyJson).to || "");
        const subject = String((params as AnyJson).subject || "");
        const body = String((params as AnyJson).body || "");
        const cc = String((params as AnyJson).cc || "");
        const bcc = String((params as AnyJson).bcc || "");
        const attachments = (params as AnyJson).attachments as
          | Array<{ filename: string; mimeType: string; dataBase64: string }>
          | undefined;
        if (!to || !subject) return jsonErr("to and subject are required");
        if (!attachments || !attachments.length) {
          return jsonErr("attachments array is required (use send_message for plain emails)");
        }
        const hdrs: Record<string, string> = { To: to, Subject: subject };
        if (cc) hdrs["Cc"] = cc;
        if (bcc) hdrs["Bcc"] = bcc;
        const raw = buildRawEmailWithAttachments(hdrs, body, attachments);
        const data = await gFetch(userId, "/messages/send", {
          method: "POST",
          body: JSON.stringify({ raw }),
        });
        return jsonOk({ success: true, message: data });
      }

      // ── Tier 1: Star / Read state shortcuts (uses /modify under the hood) ──
      case "star_message": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(userId, `/messages/${encodeURIComponent(id)}/modify`, {
          method: "POST",
          body: JSON.stringify({ addLabelIds: ["STARRED"], removeLabelIds: [] }),
        });
        return jsonOk({ success: true, message: data });
      }

      case "unstar_message": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(userId, `/messages/${encodeURIComponent(id)}/modify`, {
          method: "POST",
          body: JSON.stringify({ addLabelIds: [], removeLabelIds: ["STARRED"] }),
        });
        return jsonOk({ success: true, message: data });
      }

      case "mark_read": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(userId, `/messages/${encodeURIComponent(id)}/modify`, {
          method: "POST",
          body: JSON.stringify({ addLabelIds: [], removeLabelIds: ["UNREAD"] }),
        });
        return jsonOk({ success: true, message: data });
      }

      case "mark_unread": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(userId, `/messages/${encodeURIComponent(id)}/modify`, {
          method: "POST",
          body: JSON.stringify({ addLabelIds: ["UNREAD"], removeLabelIds: [] }),
        });
        return jsonOk({ success: true, message: data });
      }

      case "mark_important": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(userId, `/messages/${encodeURIComponent(id)}/modify`, {
          method: "POST",
          body: JSON.stringify({ addLabelIds: ["IMPORTANT"], removeLabelIds: [] }),
        });
        return jsonOk({ success: true, message: data });
      }

      case "archive_message": {
        // archive = remove INBOX label (gmail-deletion-policy compliant: never hard-delete)
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(userId, `/messages/${encodeURIComponent(id)}/modify`, {
          method: "POST",
          body: JSON.stringify({ addLabelIds: [], removeLabelIds: ["INBOX"] }),
        });
        return jsonOk({ success: true, message: data });
      }

      // ── Tier 1: Label management ──
      case "create_label": {
        const name = String((params as AnyJson).name || "");
        if (!name) return jsonErr("name is required");
        const data = await gFetch(userId, "/labels", {
          method: "POST",
          body: JSON.stringify({
            name,
            labelListVisibility: "labelShow",
            messageListVisibility: "show",
          }),
        });
        return jsonOk({ success: true, label: data });
      }

      case "delete_label": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        await gFetch(userId, `/labels/${encodeURIComponent(id)}`, { method: "DELETE" });
        return jsonOk({ success: true });
      }

      // ── Layer 2: Auto-ingest controls + archive search ──
      case "enable_auto_ingest": {
        const accountEmail = String((params as AnyJson).accountEmail || "").trim();
        const enabled = (params as AnyJson).enabled === undefined ? true : Boolean((params as AnyJson).enabled);
        if (!accountEmail) return jsonErr("accountEmail is required");
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
        const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { error } = await db
          .from("email_ingest_state")
          .upsert(
            { user_id: userId, account_email: accountEmail, enabled },
            { onConflict: "user_id,account_email" },
          );
        if (error) return jsonErr(`Failed to update ingest state: ${error.message}`, 500);
        return jsonOk({ success: true, accountEmail, enabled, message: enabled ? `Auto-ingest enabled for ${accountEmail}. Polling every 15 minutes.` : `Auto-ingest paused for ${accountEmail}.` });
      }

      case "search_attachments_archive": {
        const query = String((params as AnyJson).query || "").trim();
        const limit = Number((params as AnyJson).limit || 5);
        if (!query) return jsonErr("query is required");
        const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");
        if (!OPENAI_KEY) return jsonErr("OPENAI_API_KEY not configured", 500);
        const embRes = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "text-embedding-3-small", input: query }),
        });
        if (!embRes.ok) return jsonErr(`Embedding failed: ${await embRes.text()}`, 502);
        const embJson = await embRes.json();
        const embedding = embJson?.data?.[0]?.embedding;
        if (!embedding) return jsonErr("No embedding returned", 502);
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.49.1");
        const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const { data, error } = await db.rpc("match_email_attachments", {
          query_embedding: embedding,
          match_threshold: 0.3,
          match_count: limit,
          filter_user_id: userId,
        });
        if (error) return jsonErr(`Search failed: ${error.message}`, 500);
        const results = (data || []).map((r: AnyJson) => ({
          filename: r.filename,
          sender: r.sender,
          subject: r.subject,
          received_at: r.received_at,
          summary: r.summary,
          excerpt: String(r.extracted_text || "").slice(0, 500),
          similarity: r.similarity,
        }));
        return jsonOk({ success: true, query, count: results.length, results });
      }

      default:
        return jsonErr(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error("[google-gmail] error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return jsonErr(msg, 500);
  }
});
