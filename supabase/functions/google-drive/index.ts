import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  getAuthedUserId,
  getGoogleAccessToken,
  jsonErr,
  jsonOk,
} from "../_shared/google-token.ts";

const DRIVE_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";

type AnyJson = Record<string, unknown>;

async function gFetch(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    if (!res.ok) throw new Error(`Drive API ${res.status}: ${await res.text()}`);
    return res; // caller handles binary
  }
  const data = await res.json();
  if (!res.ok) throw new Error(`Drive API ${res.status}: ${JSON.stringify(data)}`);
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
      case "list_files": {
        const q = String((params as AnyJson).q || "");
        const pageSize = Number((params as AnyJson).pageSize || 25);
        const fields = String(
          (params as AnyJson).fields || "files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,owners,parents),nextPageToken",
        );
        const qs = new URLSearchParams();
        qs.set("pageSize", String(Math.min(100, Math.max(1, pageSize))));
        qs.set("fields", fields);
        if (q) qs.set("q", q);
        const data = await gFetch(token, `${DRIVE_BASE}/files?${qs.toString()}`);
        return jsonOk({ success: true, ...(data as AnyJson) });
      }

      case "search_files": {
        const name = String((params as AnyJson).name || "");
        if (!name) return jsonErr("name is required");
        const q = `name contains '${name.replace(/'/g, "\\'")}' and trashed = false`;
        const qs = new URLSearchParams();
        qs.set("q", q);
        qs.set("pageSize", "25");
        qs.set(
          "fields",
          "files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink),nextPageToken",
        );
        const data = await gFetch(token, `${DRIVE_BASE}/files?${qs.toString()}`);
        return jsonOk({ success: true, ...(data as AnyJson) });
      }

      case "get_file": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const fields = String(
          (params as AnyJson).fields ||
            "id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,iconLink,owners,parents",
        );
        const data = await gFetch(
          token,
          `${DRIVE_BASE}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`,
        );
        return jsonOk({ success: true, file: data });
      }

      case "download_file": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const res = await fetch(
          `${DRIVE_BASE}/files/${encodeURIComponent(id)}?alt=media`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Drive download ${res.status}: ${text}`);
        }
        // Stream binary back to caller
        return new Response(res.body, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": res.headers.get("content-type") || "application/octet-stream",
          },
        });
      }

      case "upload_file": {
        // Multipart upload with metadata + base64-encoded contents
        const name = String((params as AnyJson).name || "");
        const mimeType = String((params as AnyJson).mimeType || "application/octet-stream");
        const contentBase64 = String((params as AnyJson).contentBase64 || "");
        const parents = (params as AnyJson).parents as string[] | undefined;
        if (!name || !contentBase64) return jsonErr("name and contentBase64 are required");

        const bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0));
        const boundary = "---LovableBoundary" + Date.now();
        const metadata: AnyJson = { name, mimeType };
        if (parents && parents.length) metadata.parents = parents;

        const enc = new TextEncoder();
        const parts: Uint8Array[] = [];
        parts.push(
          enc.encode(
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
          ),
        );
        parts.push(
          enc.encode(
            `--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: binary\r\n\r\n`,
          ),
        );
        parts.push(bytes);
        parts.push(enc.encode(`\r\n--${boundary}--\r\n`));

        let total = 0;
        for (const p of parts) total += p.length;
        const body = new Uint8Array(total);
        let offset = 0;
        for (const p of parts) {
          body.set(p, offset);
          offset += p.length;
        }

        const res = await fetch(
          `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": `multipart/related; boundary=${boundary}`,
            },
            body,
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(`Drive upload ${res.status}: ${JSON.stringify(data)}`);
        if (data.id) data.webViewLink = data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`;
        return jsonOk({ success: true, file: data });
      }

      default:
        return jsonErr(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error("[google-drive] error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return jsonErr(msg, 500);
  }
});
