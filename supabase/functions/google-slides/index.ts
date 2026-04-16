import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  getAuthedUserId,
  getGoogleAccessToken,
  jsonErr,
  jsonOk,
} from "../_shared/google-token.ts";

const SLIDES_BASE = "https://slides.googleapis.com/v1";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

type AnyJson = Record<string, unknown>;

async function gFetch(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Slides API ${res.status}: ${JSON.stringify(data)}`);
  return data as AnyJson;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await getAuthedUserId(req);
    const { action, params = {} } = (await req.json()) as { action: string; params?: AnyJson };
    if (!action) return jsonErr("Missing action");

    const token = await getGoogleAccessToken(userId);
    const p = params as AnyJson;

    switch (action) {
      case "list_presentations": {
        // Slides has no native list; use Drive with mimeType filter
        const pageSize = Number(p.pageSize || 50);
        const q = `mimeType='application/vnd.google-apps.presentation' and trashed=false`;
        const qs = new URLSearchParams({
          q,
          pageSize: String(pageSize),
          fields: "files(id,name,modifiedTime,owners,webViewLink,thumbnailLink),nextPageToken",
        });
        if (p.pageToken) qs.set("pageToken", String(p.pageToken));
        const data = await gFetch(token, `${DRIVE_BASE}/files?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      case "get_presentation": {
        const presentationId = String(p.presentationId || "");
        if (!presentationId) return jsonErr("presentationId is required");
        const data = await gFetch(token, `${SLIDES_BASE}/presentations/${encodeURIComponent(presentationId)}`);
        return jsonOk({ success: true, ...data });
      }

      case "create_presentation": {
        const title = String(p.title || "Untitled Presentation");
        const data = await gFetch(token, `${SLIDES_BASE}/presentations`, {
          method: "POST",
          body: JSON.stringify({ title }),
        });
        return jsonOk({ success: true, ...data });
      }

      case "batch_update": {
        const presentationId = String(p.presentationId || "");
        if (!presentationId) return jsonErr("presentationId is required");
        const requests = p.requests as AnyJson[] | undefined;
        if (!requests?.length) return jsonErr("requests array is required");
        const data = await gFetch(
          token,
          `${SLIDES_BASE}/presentations/${encodeURIComponent(presentationId)}:batchUpdate`,
          { method: "POST", body: JSON.stringify({ requests }) },
        );
        return jsonOk({ success: true, ...data });
      }

      case "get_page": {
        const presentationId = String(p.presentationId || "");
        const pageObjectId = String(p.pageObjectId || "");
        if (!presentationId || !pageObjectId) return jsonErr("presentationId and pageObjectId are required");
        const data = await gFetch(
          token,
          `${SLIDES_BASE}/presentations/${encodeURIComponent(presentationId)}/pages/${encodeURIComponent(pageObjectId)}`,
        );
        return jsonOk({ success: true, ...data });
      }

      case "get_thumbnail": {
        const presentationId = String(p.presentationId || "");
        const pageObjectId = String(p.pageObjectId || "");
        if (!presentationId || !pageObjectId) return jsonErr("presentationId and pageObjectId are required");
        const qs = new URLSearchParams();
        if (p.mimeType) qs.set("thumbnailProperties.mimeType", String(p.mimeType));
        if (p.thumbnailSize) qs.set("thumbnailProperties.thumbnailSize", String(p.thumbnailSize));
        const url = `${SLIDES_BASE}/presentations/${encodeURIComponent(presentationId)}/pages/${encodeURIComponent(pageObjectId)}/thumbnail${qs.toString() ? "?" + qs.toString() : ""}`;
        const data = await gFetch(token, url);
        return jsonOk({ success: true, ...data });
      }

      case "add_slide": {
        const presentationId = String(p.presentationId || "");
        if (!presentationId) return jsonErr("presentationId is required");
        const insertionIndex = p.insertionIndex !== undefined ? Number(p.insertionIndex) : undefined;
        const layout = String(p.layout || "BLANK");
        const req: AnyJson = {
          createSlide: {
            slideLayoutReference: { predefinedLayout: layout },
            ...(insertionIndex !== undefined ? { insertionIndex } : {}),
          },
        };
        const data = await gFetch(
          token,
          `${SLIDES_BASE}/presentations/${encodeURIComponent(presentationId)}:batchUpdate`,
          { method: "POST", body: JSON.stringify({ requests: [req] }) },
        );
        return jsonOk({ success: true, ...data });
      }

      case "delete_slide": {
        const presentationId = String(p.presentationId || "");
        const objectId = String(p.objectId || "");
        if (!presentationId || !objectId) return jsonErr("presentationId and objectId are required");
        const data = await gFetch(
          token,
          `${SLIDES_BASE}/presentations/${encodeURIComponent(presentationId)}:batchUpdate`,
          { method: "POST", body: JSON.stringify({ requests: [{ deleteObject: { objectId } }] }) },
        );
        return jsonOk({ success: true, ...data });
      }

      case "replace_text": {
        const presentationId = String(p.presentationId || "");
        const find = String(p.find || "");
        const replace = String(p.replace ?? "");
        if (!presentationId || !find) return jsonErr("presentationId and find are required");
        const data = await gFetch(
          token,
          `${SLIDES_BASE}/presentations/${encodeURIComponent(presentationId)}:batchUpdate`,
          {
            method: "POST",
            body: JSON.stringify({
              requests: [{
                replaceAllText: {
                  containsText: { text: find, matchCase: !!p.matchCase },
                  replaceText: replace,
                },
              }],
            }),
          },
        );
        return jsonOk({ success: true, ...data });
      }

      case "export_presentation": {
        const presentationId = String(p.presentationId || "");
        const mimeType = String(p.mimeType || "application/pdf");
        if (!presentationId) return jsonErr("presentationId is required");
        const url = `${DRIVE_BASE}/files/${encodeURIComponent(presentationId)}/export?mimeType=${encodeURIComponent(mimeType)}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`Export failed ${res.status}: ${t}`);
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        // Return base64 to keep JSON-friendly
        const b64 = btoa(String.fromCharCode(...buf));
        return jsonOk({ success: true, mimeType, base64: b64, size: buf.length });
      }

      default:
        return jsonErr(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error("[google-slides] error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return jsonErr(msg, 500);
  }
});
