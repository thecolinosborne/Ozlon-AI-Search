import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  getAuthedUserId,
  getGoogleAccessToken,
  jsonErr,
  jsonOk,
} from "../_shared/google-token.ts";

const TM_BASE = "https://www.googleapis.com/tagmanager/v2";

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
  if (!res.ok) throw new Error(`Tag Manager API ${res.status}: ${JSON.stringify(data)}`);
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
      case "list_accounts": {
        const data = await gFetch(token, `${TM_BASE}/accounts`);
        return jsonOk({ success: true, ...data });
      }

      case "get_account": {
        const accountId = String(p.accountId || "");
        if (!accountId) return jsonErr("accountId is required");
        const data = await gFetch(token, `${TM_BASE}/accounts/${encodeURIComponent(accountId)}`);
        return jsonOk({ success: true, ...data });
      }

      case "list_containers": {
        const accountId = String(p.accountId || "");
        if (!accountId) return jsonErr("accountId is required");
        const data = await gFetch(token, `${TM_BASE}/accounts/${encodeURIComponent(accountId)}/containers`);
        return jsonOk({ success: true, ...data });
      }

      case "get_container": {
        const path = String(p.path || ""); // accounts/{aid}/containers/{cid}
        if (!path) return jsonErr("path is required (accounts/{aid}/containers/{cid})");
        const data = await gFetch(token, `${TM_BASE}/${path}`);
        return jsonOk({ success: true, ...data });
      }

      case "create_container": {
        const accountId = String(p.accountId || "");
        const body = p.container as AnyJson;
        if (!accountId || !body) return jsonErr("accountId and container are required");
        const data = await gFetch(token, `${TM_BASE}/accounts/${encodeURIComponent(accountId)}/containers`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        return jsonOk({ success: true, ...data });
      }

      case "list_workspaces": {
        const containerPath = String(p.containerPath || "");
        if (!containerPath) return jsonErr("containerPath required (accounts/{aid}/containers/{cid})");
        const data = await gFetch(token, `${TM_BASE}/${containerPath}/workspaces`);
        return jsonOk({ success: true, ...data });
      }

      case "list_tags": {
        const workspacePath = String(p.workspacePath || "");
        if (!workspacePath) return jsonErr("workspacePath required (accounts/.../workspaces/{wid})");
        const data = await gFetch(token, `${TM_BASE}/${workspacePath}/tags`);
        return jsonOk({ success: true, ...data });
      }

      case "create_tag": {
        const workspacePath = String(p.workspacePath || "");
        const tag = p.tag as AnyJson;
        if (!workspacePath || !tag) return jsonErr("workspacePath and tag are required");
        const data = await gFetch(token, `${TM_BASE}/${workspacePath}/tags`, {
          method: "POST",
          body: JSON.stringify(tag),
        });
        return jsonOk({ success: true, ...data });
      }

      case "update_tag": {
        const tagPath = String(p.tagPath || "");
        const tag = p.tag as AnyJson;
        if (!tagPath || !tag) return jsonErr("tagPath and tag are required");
        const data = await gFetch(token, `${TM_BASE}/${tagPath}`, {
          method: "PUT",
          body: JSON.stringify(tag),
        });
        return jsonOk({ success: true, ...data });
      }

      case "delete_tag": {
        const tagPath = String(p.tagPath || "");
        if (!tagPath) return jsonErr("tagPath is required");
        const res = await fetch(`${TM_BASE}/${tagPath}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`Delete failed ${res.status}: ${t}`);
        }
        return jsonOk({ success: true });
      }

      case "list_triggers": {
        const workspacePath = String(p.workspacePath || "");
        if (!workspacePath) return jsonErr("workspacePath required");
        const data = await gFetch(token, `${TM_BASE}/${workspacePath}/triggers`);
        return jsonOk({ success: true, ...data });
      }

      case "create_trigger": {
        const workspacePath = String(p.workspacePath || "");
        const trigger = p.trigger as AnyJson;
        if (!workspacePath || !trigger) return jsonErr("workspacePath and trigger are required");
        const data = await gFetch(token, `${TM_BASE}/${workspacePath}/triggers`, {
          method: "POST",
          body: JSON.stringify(trigger),
        });
        return jsonOk({ success: true, ...data });
      }

      case "list_variables": {
        const workspacePath = String(p.workspacePath || "");
        if (!workspacePath) return jsonErr("workspacePath required");
        const data = await gFetch(token, `${TM_BASE}/${workspacePath}/variables`);
        return jsonOk({ success: true, ...data });
      }

      case "create_variable": {
        const workspacePath = String(p.workspacePath || "");
        const variable = p.variable as AnyJson;
        if (!workspacePath || !variable) return jsonErr("workspacePath and variable are required");
        const data = await gFetch(token, `${TM_BASE}/${workspacePath}/variables`, {
          method: "POST",
          body: JSON.stringify(variable),
        });
        return jsonOk({ success: true, ...data });
      }

      case "list_versions": {
        const containerPath = String(p.containerPath || "");
        if (!containerPath) return jsonErr("containerPath required");
        const data = await gFetch(token, `${TM_BASE}/${containerPath}/version_headers`);
        return jsonOk({ success: true, ...data });
      }

      case "create_version": {
        const workspacePath = String(p.workspacePath || "");
        if (!workspacePath) return jsonErr("workspacePath required");
        const body = (p.body as AnyJson) || { name: "Version " + new Date().toISOString() };
        const data = await gFetch(token, `${TM_BASE}/${workspacePath}:create_version`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        return jsonOk({ success: true, ...data });
      }

      case "publish_version": {
        const versionPath = String(p.versionPath || "");
        if (!versionPath) return jsonErr("versionPath required (accounts/.../versions/{vid})");
        const data = await gFetch(token, `${TM_BASE}/${versionPath}:publish`, { method: "POST" });
        return jsonOk({ success: true, ...data });
      }

      default:
        return jsonErr(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error("[google-tag-manager] error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return jsonErr(msg, 500);
  }
});
