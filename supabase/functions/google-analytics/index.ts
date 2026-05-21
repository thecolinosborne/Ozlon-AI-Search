import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  getAuthedUserId,
  getGoogleAccessToken,
  jsonErr,
  jsonOk,
} from "../_shared/google-token.ts";

const ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";
const DATA_BASE = "https://analyticsdata.googleapis.com/v1beta";

type AnyJson = Record<string, unknown>;

async function gFetch(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Analytics API ${res.status}: ${JSON.stringify(data)}`);
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
      case "list_accounts": {
        const data = await gFetch(token, `${ADMIN_BASE}/accounts`);
        return jsonOk({ success: true, ...data });
      }

      case "list_properties": {
        const accountId = String((params as AnyJson).accountId || "");
        // When no accountId is provided, GA Admin's /properties endpoint rejects with
        // "filter required". Fall back to accountSummaries.list — the official discovery
        // flow that returns every account + its properties in one call.
        if (!accountId) {
          const data = await gFetch(token, `${ADMIN_BASE}/accountSummaries?pageSize=200`);
          const summaries = (data?.accountSummaries as Array<AnyJson>) || [];
          const flat = summaries.map((s) => ({
            accountId: String(s.account || "").replace(/^accounts\//, ""),
            accountDisplayName: s.displayName,
            properties: ((s.propertySummaries as Array<AnyJson>) || []).map((p) => ({
              id: String(p.property || "").replace(/^properties\//, ""),
              property: p.property, // full "properties/<id>" form for direct use
              displayName: p.displayName,
              propertyType: p.propertyType,
            })),
          }));
          return jsonOk({ success: true, accountSummaries: flat });
        }
        const qs = new URLSearchParams();
        qs.set("filter", `parent:accounts/${accountId}`);
        qs.set("pageSize", "200");
        const data = await gFetch(token, `${ADMIN_BASE}/properties?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      case "run_report": {
        let propertyId = String((params as AnyJson).propertyId || "").trim();
        if (!propertyId) return jsonErr("propertyId is required");
        // Strip "properties/" prefix if model included it.
        propertyId = propertyId.replace(/^properties\//, "");
        // Guard: GA Data API requires a numeric property ID. Reject names like "Ozlon"
        // up-front with a structured, actionable error instead of a 400 from Google.
        if (!/^\d+$/.test(propertyId)) {
          return jsonErr(
            `Invalid propertyId "${propertyId}". A numeric GA4 Property ID is required (e.g. "123456789"). Call ga4_list_properties first to discover valid IDs.`,
            400,
          );
        }
        const reportBody = (params as AnyJson).report as AnyJson;
        if (!reportBody) return jsonErr("report object is required (dimensions, metrics, dateRanges)");
        const data = await gFetch(token, `${DATA_BASE}/properties/${propertyId}:runReport`, {
          method: "POST",
          body: JSON.stringify(reportBody),
        });
        return jsonOk({ success: true, ...data });
      }

      case "run_realtime_report": {
        const propertyId = String((params as AnyJson).propertyId || "");
        if (!propertyId) return jsonErr("propertyId is required");
        const reportBody = (params as AnyJson).report as AnyJson || {};
        const data = await gFetch(token, `${DATA_BASE}/properties/${encodeURIComponent(propertyId)}:runRealtimeReport`, {
          method: "POST",
          body: JSON.stringify(reportBody),
        });
        return jsonOk({ success: true, ...data });
      }

      case "batch_run_reports": {
        const propertyId = String((params as AnyJson).propertyId || "");
        if (!propertyId) return jsonErr("propertyId is required");
        const requests = (params as AnyJson).requests as AnyJson[] | undefined;
        if (!requests?.length) return jsonErr("requests array is required");
        const data = await gFetch(token, `${DATA_BASE}/properties/${encodeURIComponent(propertyId)}:batchRunReports`, {
          method: "POST",
          body: JSON.stringify({ requests }),
        });
        return jsonOk({ success: true, ...data });
      }

      case "get_metadata": {
        const propertyId = String((params as AnyJson).propertyId || "");
        if (!propertyId) return jsonErr("propertyId is required");
        const data = await gFetch(token, `${DATA_BASE}/properties/${encodeURIComponent(propertyId)}/metadata`);
        return jsonOk({ success: true, ...data });
      }

      default:
        return jsonErr(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error("[google-analytics] error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return jsonErr(msg, 500);
  }
});
