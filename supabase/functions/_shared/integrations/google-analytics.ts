import type { IntegrationManifest } from "./types.ts";

export const googleAnalyticsIntegration: IntegrationManifest = {
  id: "google-analytics",
  displayName: "Google Analytics 4",
  edgeFunction: "google-analytics",
  envelope: "nested",
  tools: [
    {
      name: "ga4_list_accounts",
      description: "List the user's GA4 accounts.",
      action: "list_accounts",
      schema: { type: "object", properties: {} },
    },
    {
      name: "ga4_list_properties",
      description: "List GA4 properties for a given account.",
      action: "list_properties",
      schema: {
        type: "object",
        properties: { accountId: { type: "string" } },
      },
      mapArgs: (a) => ({ accountId: a.accountId }),
    },
    {
      name: "ga4_run_report",
      description:
        "Run a GA4 standard report. REQUIRES a NUMERIC propertyId (e.g. \"123456789\") — never a property name or display label. If you don't know the numeric ID, call ga4_list_properties FIRST and use the `id` field from its response. Then provide date range, dimensions and metrics.",
      action: "run_report",
      schema: {
        type: "object",
        properties: {
          propertyId: { type: "string", pattern: "^\\d+$", description: "NUMERIC GA4 property ID only (e.g. \"123456789\"). No 'properties/' prefix, no display name. Call ga4_list_properties to discover it." },
          startDate: { type: "string", description: "YYYY-MM-DD or relative like '7daysAgo'" },
          endDate: { type: "string", description: "YYYY-MM-DD or 'today'" },
          dimensions: { type: "array", items: { type: "string" } },
          metrics: { type: "array", items: { type: "string" } },
          limit: { type: "number" },
          report: { type: "object", description: "Optional raw GA4 RunReport body. If provided, used as-is." },
        },
        required: ["propertyId"],
      },
      mapArgs: (a) => {
        if (a.report && typeof a.report === "object") {
          return { propertyId: a.propertyId, report: a.report };
        }
        const dims = Array.isArray(a.dimensions) ? a.dimensions : [];
        const mets = Array.isArray(a.metrics) ? a.metrics : [];
        const report: Record<string, unknown> = {
          dateRanges: [{ startDate: a.startDate ?? "7daysAgo", endDate: a.endDate ?? "today" }],
          dimensions: dims.map((name: string) => ({ name })),
          metrics: mets.map((name: string) => ({ name })),
        };
        if (a.limit) report.limit = a.limit;
        return { propertyId: a.propertyId, report };
      },
      formatter: (data) => {
        const d = data as Record<string, unknown>;
        const rows = (d?.rows as Array<Record<string, unknown>>) || [];
        const dimHeaders = ((d?.dimensionHeaders as Array<{ name: string }>) || []).map((h) => h.name);
        const metHeaders = ((d?.metricHeaders as Array<{ name: string }>) || []).map((h) => h.name);
        if (!rows.length) return JSON.stringify({ rows: [], totals: d?.totals ?? null }, null, 2);
        const flat = rows.map((r) => {
          const dimVals = (r.dimensionValues as Array<{ value: string }>) || [];
          const metVals = (r.metricValues as Array<{ value: string }>) || [];
          const out: Record<string, string> = {};
          dimHeaders.forEach((h, i) => (out[h] = dimVals[i]?.value ?? ""));
          metHeaders.forEach((h, i) => (out[h] = metVals[i]?.value ?? ""));
          return out;
        });
        return JSON.stringify({ rowCount: d?.rowCount ?? flat.length, rows: flat, totals: d?.totals ?? null }, null, 2);
      },
    },
    {
      name: "ga4_realtime_report",
      description: "Run a GA4 realtime report (last 30 minutes of activity).",
      action: "run_realtime_report",
      schema: {
        type: "object",
        properties: {
          propertyId: { type: "string" },
          dimensions: { type: "array", items: { type: "string" } },
          metrics: { type: "array", items: { type: "string" } },
          report: { type: "object", description: "Optional raw GA4 realtime body." },
        },
        required: ["propertyId", "metrics"],
      },
      mapArgs: (a) => {
        if (a.report && typeof a.report === "object") {
          return { propertyId: a.propertyId, report: a.report };
        }
        const dims = Array.isArray(a.dimensions) ? a.dimensions : [];
        const mets = Array.isArray(a.metrics) ? a.metrics : [];
        return {
          propertyId: a.propertyId,
          report: {
            dimensions: dims.map((name: string) => ({ name })),
            metrics: mets.map((name: string) => ({ name })),
          },
        };
      },
    },
    {
      name: "ga4_get_metadata",
      description: "Get available dimension/metric metadata for a GA4 property.",
      action: "get_metadata",
      schema: {
        type: "object",
        properties: { propertyId: { type: "string" } },
        required: ["propertyId"],
      },
      mapArgs: (a) => ({ propertyId: a.propertyId }),
    },
  ],
};
