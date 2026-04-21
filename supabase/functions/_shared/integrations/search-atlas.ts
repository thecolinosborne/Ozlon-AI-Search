import type { IntegrationManifest } from "./types.ts";

// Search Atlas receiver uses FLAT envelope.
export const searchAtlasIntegration: IntegrationManifest = {
  id: "search-atlas",
  displayName: "Search Atlas",
  edgeFunction: "search-atlas",
  envelope: "flat",
  tools: [
    {
      name: "searchatlas_list_projects",
      description: "List the user's Search Atlas projects.",
      action: "list_projects",
      schema: { type: "object", properties: {} },
    },
    {
      name: "searchatlas_audit_site",
      description: "Run a Search Atlas site audit on a domain.",
      action: "audit_site",
      schema: {
        type: "object",
        properties: { domain: { type: "string" } },
        required: ["domain"],
      },
      mapArgs: (a) => ({ domain: a.domain }),
    },
    {
      name: "searchatlas_site_explorer",
      description: "Search Atlas Site Explorer overview for a domain.",
      action: "site_explorer",
      schema: {
        type: "object",
        properties: { domain: { type: "string" } },
        required: ["domain"],
      },
      mapArgs: (a) => ({ domain: a.domain }),
    },
    {
      name: "searchatlas_keyword_research",
      description: "Run keyword research for a seed keyword.",
      action: "keyword_research",
      schema: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          country: { type: "string" },
        },
        required: ["keyword"],
      },
      mapArgs: (a) => ({ keyword: a.keyword, country: a.country }),
    },
    {
      name: "searchatlas_serp_snapshot",
      description: "Capture a SERP snapshot for a keyword.",
      action: "serp_snapshot",
      schema: {
        type: "object",
        properties: { keyword: { type: "string" }, country: { type: "string" } },
        required: ["keyword"],
      },
      mapArgs: (a) => ({ keyword: a.keyword, country: a.country }),
    },
    {
      name: "searchatlas_backlinks_overview",
      description: "Get a backlinks overview for a domain.",
      action: "backlinks_overview",
      schema: {
        type: "object",
        properties: { domain: { type: "string" } },
        required: ["domain"],
      },
      mapArgs: (a) => ({ domain: a.domain }),
    },
    {
      name: "searchatlas_backlinks_list",
      description: "List backlinks for a domain.",
      action: "backlinks_list",
      schema: {
        type: "object",
        properties: { domain: { type: "string" }, limit: { type: "number" } },
        required: ["domain"],
      },
      mapArgs: (a) => ({ domain: a.domain, limit: a.limit }),
    },
    {
      name: "searchatlas_rank_tracker",
      description: "Get rank-tracker keyword positions for a project.",
      action: "rank_tracker_keywords",
      schema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
      mapArgs: (a) => ({ projectId: a.projectId }),
    },
  ],
};
