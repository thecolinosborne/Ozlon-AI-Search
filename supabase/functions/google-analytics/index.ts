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
        const filter = accountId ? `parent:accounts/${accountId}` : "";
        const qs = new URLSearchParams();
        if (filter) qs.set("filter", filter);
        qs.set("pageSize", "200");
        const data = await gFetch(token, `${ADMIN_BASE}/properties?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      case "run_report": {
        const propertyId = String((params as AnyJson).propertyId || "");
        if (!propertyId) return jsonErr("propertyId is required");
        const reportBody = (params as AnyJson).report as AnyJson;
        if (!reportBody) return jsonErr("report object is required (dimensions, metrics, dateRanges)");
        const data = await gFetch(token, `${DATA_BASE}/properties/${encodeURIComponent(propertyId)}:runReport`, {
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
