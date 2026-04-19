import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  getAuthedUserId,
  getGoogleAccessToken,
  jsonErr,
  jsonOk,
} from "../_shared/google-token.ts";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

type AnyJson = Record<string, unknown>;

async function gFetch(token: string, path: string, init: RequestInit = {}) {
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
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function buildRawEmail(headers: Record<string, string>, body: string): string {
  const lines = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
  lines.push("Content-Type: text/plain; charset=UTF-8", "", body);
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

    const token = await getGoogleAccessToken(userId);

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
        const data = await gFetch(token, `/messages?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      case "get_message": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const format = String((params as AnyJson).format || "full");
        const data = await gFetch(token, `/messages/${encodeURIComponent(id)}?format=${format}`);
        return jsonOk({ success: true, message: data });
      }

      case "send_message": {
        const to = String((params as AnyJson).to || "");
        const subject = String((params as AnyJson).subject || "");
        const body = String((params as AnyJson).body || "");
        const cc = String((params as AnyJson).cc || "");
        const bcc = String((params as AnyJson).bcc || "");
        if (!to || !subject) return jsonErr("to and subject are required");

        const hdrs: Record<string, string> = { To: to, Subject: subject };
        if (cc) hdrs["Cc"] = cc;
        if (bcc) hdrs["Bcc"] = bcc;

        const raw = buildRawEmail(hdrs, body);
        const data = await gFetch(token, "/messages/send", {
          method: "POST",
          body: JSON.stringify({ raw }),
        });
        return jsonOk({ success: true, message: data });
      }

      case "trash_message": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(token, `/messages/${encodeURIComponent(id)}/trash`, { method: "POST" });
        return jsonOk({ success: true, message: data });
      }

      case "list_labels": {
        const data = await gFetch(token, "/labels");
        return jsonOk({ success: true, ...data });
      }

      // ── New actions ──
      case "untrash_message": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(token, `/messages/${encodeURIComponent(id)}/untrash`, { method: "POST" });
        return jsonOk({ success: true, message: data });
      }

      case "modify_message": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const addLabelIds = (params as AnyJson).addLabelIds as string[] | undefined;
        const removeLabelIds = (params as AnyJson).removeLabelIds as string[] | undefined;
        const data = await gFetch(token, `/messages/${encodeURIComponent(id)}/modify`, {
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
        const data = await gFetch(token, `/threads?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      case "get_thread": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const format = String((params as AnyJson).format || "full");
        const data = await gFetch(token, `/threads/${encodeURIComponent(id)}?format=${format}`);
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
        const data = await gFetch(token, "/drafts", { method: "POST", body: JSON.stringify(draftBody) });
        return jsonOk({ success: true, draft: data });
      }

      case "list_drafts": {
        const maxResults = Number((params as AnyJson).maxResults || 20);
        const pageToken = String((params as AnyJson).pageToken || "");
        const qs = new URLSearchParams();
        qs.set("maxResults", String(Math.min(100, Math.max(1, maxResults))));
        if (pageToken) qs.set("pageToken", pageToken);
        const data = await gFetch(token, `/drafts?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      case "send_draft": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(token, "/drafts/send", {
          method: "POST",
          body: JSON.stringify({ id }),
        });
        return jsonOk({ success: true, message: data });
      }

      case "delete_draft": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        await gFetch(token, `/drafts/${encodeURIComponent(id)}`, { method: "DELETE" });
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
        const data = await gFetch(token, "/messages/send", { method: "POST", body: JSON.stringify(msgBody) });
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
        const data = await gFetch(token, `/messages?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      case "get_profile": {
        const data = await gFetch(token, "/profile");
        return jsonOk({ success: true, profile: data });
      }

      case "batch_modify": {
        const ids = (params as AnyJson).ids as string[] | undefined;
        if (!ids || !ids.length) return jsonErr("ids array is required");
        const addLabelIds = (params as AnyJson).addLabelIds as string[] | undefined;
        const removeLabelIds = (params as AnyJson).removeLabelIds as string[] | undefined;
        const data = await gFetch(token, "/messages/batchModify", {
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
        const data = await gFetch(token, `/history?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      // ── Tier 1: Filters ──
      case "list_filters": {
        const data = await gFetch(token, "/settings/filters");
        return jsonOk({ success: true, ...(data as AnyJson) });
      }

      case "create_filter": {
        const criteria = (params as AnyJson).criteria as AnyJson | undefined;
        const action = (params as AnyJson).action as AnyJson | undefined;
        if (!criteria || !action) return jsonErr("criteria and action are required");
        const data = await gFetch(token, "/settings/filters", {
          method: "POST",
          body: JSON.stringify({ criteria, action }),
        });
        return jsonOk({ success: true, filter: data });
      }

      case "delete_filter": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        await gFetch(token, `/settings/filters/${encodeURIComponent(id)}`, { method: "DELETE" });
        return jsonOk({ success: true });
      }

      case "get_filter": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(token, `/settings/filters/${encodeURIComponent(id)}`);
        return jsonOk({ success: true, filter: data });
      }

      // ── Tier 1: Vacation / Vacation Responder ──
      case "get_vacation": {
        const data = await gFetch(token, "/settings/vacation");
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
        const data = await gFetch(token, "/settings/vacation", {
          method: "PUT",
          body: JSON.stringify(body),
        });
        return jsonOk({ success: true, vacation: data });
      }

      // ── Tier 1: SendAs / Signatures ──
      case "list_send_as": {
        const data = await gFetch(token, "/settings/sendAs");
        return jsonOk({ success: true, ...(data as AnyJson) });
      }

      case "update_signature": {
        const sendAsEmail = String((params as AnyJson).sendAsEmail || "");
        const signature = String((params as AnyJson).signature || "");
        if (!sendAsEmail) return jsonErr("sendAsEmail is required");
        const data = await gFetch(
          token,
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
        const data = await gFetch(token, "/messages/send", {
          method: "POST",
          body: JSON.stringify({ raw }),
        });
        return jsonOk({ success: true, message: data });
      }

      // ── Tier 1: Attachments ──
      case "get_attachment": {
        const messageId = String((params as AnyJson).messageId || "");
        const attachmentId = String((params as AnyJson).attachmentId || "");
        if (!messageId || !attachmentId) return jsonErr("messageId and attachmentId are required");
        const data = await gFetch(
          token,
          `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
        );
        return jsonOk({ success: true, attachment: data });
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
        const data = await gFetch(token, "/messages/send", {
          method: "POST",
          body: JSON.stringify({ raw }),
        });
        return jsonOk({ success: true, message: data });
      }

      // ── Tier 1: Star / Read state shortcuts (uses /modify under the hood) ──
      case "star_message": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(token, `/messages/${encodeURIComponent(id)}/modify`, {
          method: "POST",
          body: JSON.stringify({ addLabelIds: ["STARRED"], removeLabelIds: [] }),
        });
        return jsonOk({ success: true, message: data });
      }

      case "unstar_message": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(token, `/messages/${encodeURIComponent(id)}/modify`, {
          method: "POST",
          body: JSON.stringify({ addLabelIds: [], removeLabelIds: ["STARRED"] }),
        });
        return jsonOk({ success: true, message: data });
      }

      case "mark_read": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(token, `/messages/${encodeURIComponent(id)}/modify`, {
          method: "POST",
          body: JSON.stringify({ addLabelIds: [], removeLabelIds: ["UNREAD"] }),
        });
        return jsonOk({ success: true, message: data });
      }

      case "mark_unread": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(token, `/messages/${encodeURIComponent(id)}/modify`, {
          method: "POST",
          body: JSON.stringify({ addLabelIds: ["UNREAD"], removeLabelIds: [] }),
        });
        return jsonOk({ success: true, message: data });
      }

      case "mark_important": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(token, `/messages/${encodeURIComponent(id)}/modify`, {
          method: "POST",
          body: JSON.stringify({ addLabelIds: ["IMPORTANT"], removeLabelIds: [] }),
        });
        return jsonOk({ success: true, message: data });
      }

      case "archive_message": {
        // archive = remove INBOX label (gmail-deletion-policy compliant: never hard-delete)
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(token, `/messages/${encodeURIComponent(id)}/modify`, {
          method: "POST",
          body: JSON.stringify({ addLabelIds: [], removeLabelIds: ["INBOX"] }),
        });
        return jsonOk({ success: true, message: data });
      }

      // ── Tier 1: Label management ──
      case "create_label": {
        const name = String((params as AnyJson).name || "");
        if (!name) return jsonErr("name is required");
        const data = await gFetch(token, "/labels", {
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
        await gFetch(token, `/labels/${encodeURIComponent(id)}`, { method: "DELETE" });
        return jsonOk({ success: true });
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
