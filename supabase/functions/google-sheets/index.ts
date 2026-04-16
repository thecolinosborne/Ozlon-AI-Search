import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  getAuthedUserId,
  getGoogleAccessToken,
  jsonErr,
  jsonOk,
} from "../_shared/google-token.ts";

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_BASE = "https://www.googleapis.com/drive/v3";

type AnyJson = Record<string, unknown>;

async function gFetch(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${JSON.stringify(data)}`);
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
      case "list_spreadsheets": {
        const pageSize = Number((params as AnyJson).pageSize || 25);
        const qs = new URLSearchParams();
        qs.set("q", "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
        qs.set("pageSize", String(Math.min(100, Math.max(1, pageSize))));
        qs.set("fields", "files(id,name,modifiedTime,webViewLink),nextPageToken");
        const data = await gFetch(token, `${DRIVE_BASE}/files?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      case "get_spreadsheet": {
        const spreadsheetId = String((params as AnyJson).spreadsheetId || "");
        if (!spreadsheetId) return jsonErr("spreadsheetId is required");
        const data = await gFetch(token, `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties,sheets.properties`);
        return jsonOk({ success: true, spreadsheet: data });
      }

      case "read_range": {
        const spreadsheetId = String((params as AnyJson).spreadsheetId || "");
        const range = String((params as AnyJson).range || "");
        if (!spreadsheetId || !range) return jsonErr("spreadsheetId and range are required");
        const valueRender = String((params as AnyJson).valueRenderOption || "FORMATTED_VALUE");
        const data = await gFetch(token, `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=${valueRender}`);
        return jsonOk({ success: true, ...data });
      }

      case "write_range": {
        const spreadsheetId = String((params as AnyJson).spreadsheetId || "");
        const range = String((params as AnyJson).range || "");
        const values = (params as AnyJson).values as unknown[][] | undefined;
        if (!spreadsheetId || !range || !values) return jsonErr("spreadsheetId, range, and values are required");
        const valueInput = String((params as AnyJson).valueInputOption || "USER_ENTERED");
        const data = await gFetch(token, `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=${valueInput}`, {
          method: "PUT",
          body: JSON.stringify({ values }),
        });
        return jsonOk({ success: true, ...data });
      }

      case "append_rows": {
        const spreadsheetId = String((params as AnyJson).spreadsheetId || "");
        const range = String((params as AnyJson).range || "");
        const values = (params as AnyJson).values as unknown[][] | undefined;
        if (!spreadsheetId || !range || !values) return jsonErr("spreadsheetId, range, and values are required");
        const valueInput = String((params as AnyJson).valueInputOption || "USER_ENTERED");
        const data = await gFetch(token, `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=${valueInput}&insertDataOption=INSERT_ROWS`, {
          method: "POST",
          body: JSON.stringify({ values }),
        });
        return jsonOk({ success: true, ...data });
      }

      case "clear_range": {
        const spreadsheetId = String((params as AnyJson).spreadsheetId || "");
        const range = String((params as AnyJson).range || "");
        if (!spreadsheetId || !range) return jsonErr("spreadsheetId and range are required");
        const data = await gFetch(token, `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        return jsonOk({ success: true, ...data });
      }

      case "create_spreadsheet": {
        const title = String((params as AnyJson).title || "Untitled Spreadsheet");
        const sheets = (params as AnyJson).sheets as AnyJson[] | undefined;
        const body: AnyJson = { properties: { title } };
        if (sheets) body.sheets = sheets;
        const data = await gFetch(token, SHEETS_BASE, { method: "POST", body: JSON.stringify(body) });
        return jsonOk({ success: true, spreadsheet: data });
      }

      case "add_sheet": {
        const spreadsheetId = String((params as AnyJson).spreadsheetId || "");
        const title = String((params as AnyJson).title || "New Sheet");
        if (!spreadsheetId) return jsonErr("spreadsheetId is required");
        const data = await gFetch(token, `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
        });
        return jsonOk({ success: true, ...data });
      }

      case "delete_sheet": {
        const spreadsheetId = String((params as AnyJson).spreadsheetId || "");
        const sheetId = Number((params as AnyJson).sheetId);
        if (!spreadsheetId) return jsonErr("spreadsheetId is required");
        const data = await gFetch(token, `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ requests: [{ deleteSheet: { sheetId } }] }),
        });
        return jsonOk({ success: true, ...data });
      }

      case "batch_update": {
        const spreadsheetId = String((params as AnyJson).spreadsheetId || "");
        const requests = (params as AnyJson).requests as AnyJson[] | undefined;
        if (!spreadsheetId || !requests) return jsonErr("spreadsheetId and requests are required");
        const data = await gFetch(token, `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({ requests }),
        });
        return jsonOk({ success: true, ...data });
      }

      case "get_values_batch": {
        const spreadsheetId = String((params as AnyJson).spreadsheetId || "");
        const ranges = (params as AnyJson).ranges as string[] | undefined;
        if (!spreadsheetId || !ranges?.length) return jsonErr("spreadsheetId and ranges are required");
        const qs = new URLSearchParams();
        ranges.forEach((r) => qs.append("ranges", r));
        const data = await gFetch(token, `${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      default:
        return jsonErr(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error("[google-sheets] error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return jsonErr(msg, 500);
  }
});
