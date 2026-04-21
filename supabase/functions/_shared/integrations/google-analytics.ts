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
        "Run a GA4 standard report. Provide propertyId, date range, dimensions and metrics.",
      action: "run_report",
      schema: {
        type: "object",
        properties: {
          propertyId: { type: "string", description: "GA4 property ID (no 'properties/' prefix)" },
          startDate: { type: "string", description: "YYYY-MM-DD or relative like '7daysAgo'" },
          endDate: { type: "string", description: "YYYY-MM-DD or 'today'" },
          dimensions: { type: "array", items: { type: "string" } },
          metrics: { type: "array", items: { type: "string" } },
          limit: { type: "number" },
        },
        required: ["propertyId", "startDate", "endDate", "metrics"],
      },
      mapArgs: (a) => ({
        propertyId: a.propertyId,
        startDate: a.startDate,
        endDate: a.endDate,
        dimensions: a.dimensions,
        metrics: a.metrics,
        limit: a.limit,
      }),
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
        },
        required: ["propertyId", "metrics"],
      },
      mapArgs: (a) => ({ propertyId: a.propertyId, dimensions: a.dimensions, metrics: a.metrics }),
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
