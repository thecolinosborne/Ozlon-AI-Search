import type { IntegrationManifest } from "./types.ts";

export const googleTagManagerIntegration: IntegrationManifest = {
  id: "google-tag-manager",
  displayName: "Google Tag Manager",
  edgeFunction: "google-tag-manager",
  envelope: "nested",
  tools: [
    {
      name: "gtm_list_accounts",
      description: "List the user's GTM accounts.",
      action: "list_accounts",
      schema: { type: "object", properties: {} },
    },
    {
      name: "gtm_list_containers",
      description: "List containers in a GTM account.",
      action: "list_containers",
      schema: {
        type: "object",
        properties: { accountId: { type: "string" } },
        required: ["accountId"],
      },
      mapArgs: (a) => ({ accountId: a.accountId }),
    },
    {
      name: "gtm_list_workspaces",
      description: "List workspaces in a GTM container.",
      action: "list_workspaces",
      schema: {
        type: "object",
        properties: { accountId: { type: "string" }, containerId: { type: "string" } },
        required: ["accountId", "containerId"],
      },
      mapArgs: (a) => ({ accountId: a.accountId, containerId: a.containerId }),
    },
    {
      name: "gtm_list_tags",
      description: "List tags in a GTM workspace.",
      action: "list_tags",
      schema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          containerId: { type: "string" },
          workspaceId: { type: "string" },
        },
        required: ["accountId", "containerId", "workspaceId"],
      },
      mapArgs: (a) => ({ accountId: a.accountId, containerId: a.containerId, workspaceId: a.workspaceId }),
    },
    {
      name: "gtm_list_triggers",
      description: "List triggers in a GTM workspace.",
      action: "list_triggers",
      schema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          containerId: { type: "string" },
          workspaceId: { type: "string" },
        },
        required: ["accountId", "containerId", "workspaceId"],
      },
      mapArgs: (a) => ({ accountId: a.accountId, containerId: a.containerId, workspaceId: a.workspaceId }),
    },
    {
      name: "gtm_publish_version",
      description: "Publish a GTM container version.",
      action: "publish_version",
      schema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          containerId: { type: "string" },
          versionId: { type: "string" },
        },
        required: ["accountId", "containerId", "versionId"],
      },
      mapArgs: (a) => ({ accountId: a.accountId, containerId: a.containerId, versionId: a.versionId }),
    },
  ],
};
