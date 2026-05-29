import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  assertGoogleScope,
  corsHeaders,
  getAuthedUserId,
  getGoogleAccessToken,
  GoogleScopeMissingError,
  jsonErr,
  jsonOk,
} from "../_shared/google-token.ts";

const GSC_BASE = "https://www.googleapis.com/webmasters/v3";
const WEBMASTERS_WRITE_SCOPE = "https://www.googleapis.com/auth/webmasters";
const WEBMASTERS_WRITE_LABEL = "Manage Search Console data for your verified sites";

const INSPECTION_BASE = "https://searchconsole.googleapis.com/v1";

type AnyJson = Record<string, unknown>;

async function gFetch(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Search Console API ${res.status}: ${JSON.stringify(data)}`);
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
      case "list_sites": {
        const data = await gFetch(token, `${GSC_BASE}/sites`);
        return jsonOk({ success: true, ...data });
      }

      case "get_site": {
        const siteUrl = String((params as AnyJson).siteUrl || "");
        if (!siteUrl) return jsonErr("siteUrl is required");
        const data = await gFetch(token, `${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}`);
        return jsonOk({ success: true, site: data });
      }

      case "search_analytics": {
        const siteUrl = String((params as AnyJson).siteUrl || "");
        if (!siteUrl) return jsonErr("siteUrl is required");
        const requestBody = (params as AnyJson).request as AnyJson;
        if (!requestBody) return jsonErr("request object is required (startDate, endDate, dimensions)");
        const data = await gFetch(token, `${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
          method: "POST",
          body: JSON.stringify(requestBody),
        });
        return jsonOk({ success: true, ...data });
      }

      case "list_sitemaps": {
        const siteUrl = String((params as AnyJson).siteUrl || "");
        if (!siteUrl) return jsonErr("siteUrl is required");
        const data = await gFetch(token, `${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}/sitemaps`);
        return jsonOk({ success: true, ...data });
      }

      case "submit_sitemap": {
        const siteUrl = String((params as AnyJson).siteUrl || "");
        const feedpath = String((params as AnyJson).feedpath || "");
        if (!siteUrl || !feedpath) return jsonErr("siteUrl and feedpath are required");
        await gFetch(token, `${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`, {
          method: "PUT",
        });
        return jsonOk({ success: true });
      }

      case "delete_sitemap": {
        const siteUrl = String((params as AnyJson).siteUrl || "");
        const feedpath = String((params as AnyJson).feedpath || "");
        if (!siteUrl || !feedpath) return jsonErr("siteUrl and feedpath are required");
        await gFetch(token, `${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`, {
          method: "DELETE",
        });
        return jsonOk({ success: true });
      }

      case "inspect_url": {
        const inspectionUrl = String((params as AnyJson).inspectionUrl || "");
        const siteUrl = String((params as AnyJson).siteUrl || "");
        if (!inspectionUrl || !siteUrl) return jsonErr("inspectionUrl and siteUrl are required");
        const data = await gFetch(token, `${INSPECTION_BASE}/urlInspection/index:inspect`, {
          method: "POST",
          body: JSON.stringify({ inspectionUrl, siteUrl }),
        });
        return jsonOk({ success: true, ...data });
      }

      default:
        return jsonErr(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error("[google-search-console] error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return jsonErr(msg, 500);
  }
});
