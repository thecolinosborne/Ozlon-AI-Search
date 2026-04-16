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
    return res;
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
      // ── Existing ──
      case "list_files": {
        const q = String((params as AnyJson).q || "");
        const pageSize = Number((params as AnyJson).pageSize || 25);
        const pageToken = String((params as AnyJson).pageToken || "");
        const fields = String(
          (params as AnyJson).fields || "files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,owners,parents),nextPageToken",
        );
        const qs = new URLSearchParams();
        qs.set("pageSize", String(Math.min(100, Math.max(1, pageSize))));
        qs.set("fields", fields);
        if (q) qs.set("q", q);
        if (pageToken) qs.set("pageToken", pageToken);
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
        qs.set("fields", "files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink),nextPageToken");
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
        const data = await gFetch(token, `${DRIVE_BASE}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`);
        return jsonOk({ success: true, file: data });
      }

      case "download_file": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const res = await fetch(`${DRIVE_BASE}/files/${encodeURIComponent(id)}?alt=media`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Drive download ${res.status}: ${text}`);
        }
        return new Response(res.body, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": res.headers.get("content-type") || "application/octet-stream",
          },
        });
      }

      case "upload_file": {
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
        parts.push(enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`));
        parts.push(enc.encode(`--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: binary\r\n\r\n`));
        parts.push(bytes);
        parts.push(enc.encode(`\r\n--${boundary}--\r\n`));

        let total = 0;
        for (const p of parts) total += p.length;
        const body = new Uint8Array(total);
        let offset = 0;
        for (const p of parts) { body.set(p, offset); offset += p.length; }

        const res = await fetch(
          `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,webViewLink`,
          { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(`Drive upload ${res.status}: ${JSON.stringify(data)}`);
        if (data.id) data.webViewLink = data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`;
        return jsonOk({ success: true, file: data });
      }

      // ── New actions ──
      case "create_folder": {
        const name = String((params as AnyJson).name || "");
        if (!name) return jsonErr("name is required");
        const parents = (params as AnyJson).parents as string[] | undefined;
        const metadata: AnyJson = { name, mimeType: "application/vnd.google-apps.folder" };
        if (parents?.length) metadata.parents = parents;
        const data = await gFetch(token, `${DRIVE_BASE}/files?fields=id,name,mimeType,webViewLink`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metadata),
        });
        return jsonOk({ success: true, folder: data });
      }

      case "move_file": {
        const id = String((params as AnyJson).id || "");
        const newParentId = String((params as AnyJson).newParentId || "");
        if (!id || !newParentId) return jsonErr("id and newParentId are required");
        // Get current parents
        const fileMeta = await gFetch(token, `${DRIVE_BASE}/files/${encodeURIComponent(id)}?fields=parents`) as AnyJson;
        const oldParents = ((fileMeta.parents || []) as string[]).join(",");
        const qs = new URLSearchParams();
        qs.set("addParents", newParentId);
        if (oldParents) qs.set("removeParents", oldParents);
        qs.set("fields", "id,name,parents");
        const data = await gFetch(token, `${DRIVE_BASE}/files/${encodeURIComponent(id)}?${qs.toString()}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
        });
        return jsonOk({ success: true, file: data });
      }

      case "copy_file": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const name = String((params as AnyJson).name || "");
        const copyBody: AnyJson = {};
        if (name) copyBody.name = name;
        const data = await gFetch(token, `${DRIVE_BASE}/files/${encodeURIComponent(id)}/copy?fields=id,name,mimeType,webViewLink`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(copyBody),
        });
        return jsonOk({ success: true, file: data });
      }

      case "rename_file": {
        const id = String((params as AnyJson).id || "");
        const name = String((params as AnyJson).name || "");
        if (!id || !name) return jsonErr("id and name are required");
        const data = await gFetch(token, `${DRIVE_BASE}/files/${encodeURIComponent(id)}?fields=id,name`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        return jsonOk({ success: true, file: data });
      }

      case "trash_file": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(token, `${DRIVE_BASE}/files/${encodeURIComponent(id)}?fields=id,name,trashed`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trashed: true }),
        });
        return jsonOk({ success: true, file: data });
      }

      case "untrash_file": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(token, `${DRIVE_BASE}/files/${encodeURIComponent(id)}?fields=id,name,trashed`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trashed: false }),
        });
        return jsonOk({ success: true, file: data });
      }

      case "delete_file": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        await gFetch(token, `${DRIVE_BASE}/files/${encodeURIComponent(id)}`, { method: "DELETE" });
        return jsonOk({ success: true });
      }

      case "list_permissions": {
        const id = String((params as AnyJson).id || "");
        if (!id) return jsonErr("id is required");
        const data = await gFetch(token, `${DRIVE_BASE}/files/${encodeURIComponent(id)}/permissions?fields=permissions(id,type,role,emailAddress,displayName)`);
        return jsonOk({ success: true, ...(data as AnyJson) });
      }

      case "share_file": {
        const id = String((params as AnyJson).id || "");
        const role = String((params as AnyJson).role || "reader");
        const type = String((params as AnyJson).type || "user");
        const emailAddress = String((params as AnyJson).emailAddress || "");
        if (!id) return jsonErr("id is required");
        if (type === "user" && !emailAddress) return jsonErr("emailAddress is required for user shares");
        const permBody: AnyJson = { role, type };
        if (emailAddress) permBody.emailAddress = emailAddress;
        const data = await gFetch(token, `${DRIVE_BASE}/files/${encodeURIComponent(id)}/permissions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(permBody),
        });
        return jsonOk({ success: true, permission: data });
      }

      case "remove_permission": {
        const fileId = String((params as AnyJson).fileId || "");
        const permissionId = String((params as AnyJson).permissionId || "");
        if (!fileId || !permissionId) return jsonErr("fileId and permissionId are required");
        await gFetch(token, `${DRIVE_BASE}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`, {
          method: "DELETE",
        });
        return jsonOk({ success: true });
      }

      case "export_file": {
        const id = String((params as AnyJson).id || "");
        const mimeType = String((params as AnyJson).mimeType || "application/pdf");
        if (!id) return jsonErr("id is required");
        const res = await fetch(`${DRIVE_BASE}/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(mimeType)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Drive export ${res.status}: ${text}`);
        }
        return new Response(res.body, {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": mimeType },
        });
      }

      case "get_storage_quota": {
        const data = await gFetch(token, `${DRIVE_BASE}/about?fields=storageQuota,user`);
        return jsonOk({ success: true, ...(data as AnyJson) });
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
