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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await getAuthedUserId(req);
    const { action, params = {} } = (await req.json()) as { action: string; params?: AnyJson };
    if (!action) return jsonErr("Missing action");

    const token = await getGoogleAccessToken(userId);

    switch (action) {
      case "list_messages": {
        const q = String((params as AnyJson).q || "");
        const maxResults = Number((params as AnyJson).maxResults || 20);
        const labelIds = (params as AnyJson).labelIds as string[] | undefined;
        const qs = new URLSearchParams();
        qs.set("maxResults", String(Math.min(100, Math.max(1, maxResults))));
        if (q) qs.set("q", q);
        if (labelIds && labelIds.length) qs.set("labelIds", labelIds.join(","));
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
        if (!to || !subject) return jsonErr("to and subject are required");

        const raw = [
          `To: ${to}`,
          `Subject: ${subject}`,
          "Content-Type: text/plain; charset=UTF-8",
          "",
          body,
        ].join("\r\n");
        // base64url encode
        const b64 = btoa(unescape(encodeURIComponent(raw)))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        const data = await gFetch(token, "/messages/send", {
          method: "POST",
          body: JSON.stringify({ raw: b64 }),
        });
        return jsonOk({ success: true, message: data });
      }

      case "trash_message": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(token, `/messages/${encodeURIComponent(id)}/trash`, {
          method: "POST",
        });
        return jsonOk({ success: true, message: data });
      }

      case "list_labels": {
        const data = await gFetch(token, "/labels");
        return jsonOk({ success: true, ...data });
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
