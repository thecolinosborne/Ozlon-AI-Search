import type { IntegrationManifest } from "./types.ts";

// Descript receiver uses FLAT envelope: { action, ...params }
export const descriptIntegration: IntegrationManifest = {
  id: "descript",
  displayName: "Descript",
  edgeFunction: "descript",
  envelope: "flat",
  tools: [
    {
      name: "descript_test_connection",
      description: "Verify Descript API key and basic auth.",
      action: "test_connection",
      schema: { type: "object", properties: {} },
    },
    {
      name: "descript_import_media",
      description: "Import a remote media file (URL) into Descript as a new project.",
      action: "import_media",
      schema: {
        type: "object",
        properties: {
          mediaUrl: { type: "string", description: "Public URL of the media to import" },
          projectName: { type: "string" },
        },
        required: ["mediaUrl"],
      },
      mapArgs: (a) => ({ mediaUrl: a.mediaUrl, projectName: a.projectName }),
    },
    {
      name: "descript_run_agent_edit",
      description:
        "Run an AI agent edit on an existing Descript project (e.g. 'remove filler words', 'create 3 social clips').",
      action: "run_agent_edit",
      schema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          intent: { type: "string", description: "Natural-language editing instruction" },
        },
        required: ["projectId", "intent"],
      },
      mapArgs: (a) => ({ projectId: a.projectId, intent: a.intent }),
    },
    {
      name: "descript_get_job_status",
      description: "Get status of a Descript edit/render job.",
      action: "get_job_status",
      schema: {
        type: "object",
        properties: { jobId: { type: "string" } },
        required: ["jobId"],
      },
      mapArgs: (a) => ({ jobId: a.jobId }),
    },
    {
      name: "descript_list_jobs",
      description: "List recent Descript jobs for the current user.",
      action: "list_jobs",
      schema: { type: "object", properties: { limit: { type: "number" } } },
      mapArgs: (a) => ({ limit: a.limit }),
    },
    {
      name: "descript_cancel_job",
      description: "Cancel a running Descript job.",
      action: "cancel_job",
      schema: {
        type: "object",
        properties: { jobId: { type: "string" } },
        required: ["jobId"],
      },
      mapArgs: (a) => ({ jobId: a.jobId }),
    },
    {
      name: "descript_get_published_project",
      description: "Fetch info about a published Descript project (links, exports).",
      action: "get_published_project",
      schema: {
        type: "object",
        properties: { projectId: { type: "string" } },
        required: ["projectId"],
      },
      mapArgs: (a) => ({ projectId: a.projectId }),
    },
  ],
};
