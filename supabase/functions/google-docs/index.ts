import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  getAuthedUserId,
  getGoogleAccessToken,
  jsonErr,
  jsonOk,
} from "../_shared/google-token.ts";

const DOCS_BASE = "https://docs.googleapis.com/v1/documents";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

type AnyJson = Record<string, unknown>;

async function gFetch(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    if (!res.ok) throw new Error(`Docs API ${res.status}: ${await res.text()}`);
    return res;
  }
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Docs API ${res.status}: ${JSON.stringify(data)}`);
  return data as AnyJson;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await getAuthedUserId(req);
    const { action, params = {} } = (await req.json()) as { action: string; params?: AnyJson };
    if (!action) return jsonErr("Missing action");

    const token = await getGoogleAccessToken(userId);

    switch (action) {
      case "list_documents": {
        const pageSize = Number((params as AnyJson).pageSize || 25);
        const qs = new URLSearchParams();
        qs.set("q", "mimeType='application/vnd.google-apps.document' and trashed=false");
        qs.set("pageSize", String(Math.min(100, Math.max(1, pageSize))));
        qs.set("fields", "files(id,name,modifiedTime,webViewLink),nextPageToken");
        const data = await gFetch(token, `${DRIVE_BASE}/files?${qs.toString()}`);
        return jsonOk({ success: true, ...(data as AnyJson) });
      }

      case "get_document": {
        const documentId = String((params as AnyJson).documentId || "");
        if (!documentId) return jsonErr("documentId is required");
        const data = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}`);
        return jsonOk({ success: true, document: data });
      }

      case "create_document": {
        const title = String((params as AnyJson).title || "Untitled Document");
        const data = await gFetch(token, DOCS_BASE, {
          method: "POST",
          body: JSON.stringify({ title }),
        });
        return jsonOk({ success: true, document: data });
      }

      case "batch_update": {
        const documentId = String((params as AnyJson).documentId || "");
        const requests = (params as AnyJson).requests as AnyJson[] | undefined;
        if (!documentId || !requests) return jsonErr("documentId and requests are required");
        const data = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ requests }),
        });
        return jsonOk({ success: true, ...data });
      }

      case "insert_text": {
        const documentId = String((params as AnyJson).documentId || "");
        const text = String((params as AnyJson).text || "");
        const index = Number((params as AnyJson).index || 1);
        if (!documentId || !text) return jsonErr("documentId and text are required");
        const data = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({
            requests: [{ insertText: { location: { index }, text } }],
          }),
        });
        return jsonOk({ success: true, ...data });
      }

      case "replace_text": {
        const documentId = String((params as AnyJson).documentId || "");
        const find = String((params as AnyJson).find || "");
        const replaceText = String((params as AnyJson).replaceText || "");
        if (!documentId || !find) return jsonErr("documentId and find are required");
        const data = await gFetch(token, `${DOCS_BASE}/${encodeURIComponent(documentId)}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({
            requests: [{ replaceAllText: { containsText: { text: find, matchCase: true }, replaceText } }],
          }),
        });
        return jsonOk({ success: true, ...data });
      }

      case "export_document": {
        const documentId = String((params as AnyJson).documentId || "");
        const mimeType = String((params as AnyJson).mimeType || "application/pdf");
        if (!documentId) return jsonErr("documentId is required");
        const res = await fetch(`${DRIVE_BASE}/files/${encodeURIComponent(documentId)}/export?mimeType=${encodeURIComponent(mimeType)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Docs export ${res.status}: ${await res.text()}`);
        return new Response(res.body, {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": mimeType },
        });
      }

      default:
        return jsonErr(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error("[google-docs] error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return jsonErr(msg, 500);
  }
});
