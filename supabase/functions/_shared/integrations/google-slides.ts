import type { IntegrationManifest } from "./types.ts";

export const googleSlidesIntegration: IntegrationManifest = {
  id: "google-slides",
  displayName: "Google Slides",
  edgeFunction: "google-slides",
  envelope: "nested",
  tools: [
    {
      name: "slides_list_presentations",
      description: "List the user's Google Slides presentations.",
      action: "list_presentations",
      schema: { type: "object", properties: { pageSize: { type: "number" } } },
      mapArgs: (a) => ({ pageSize: a.pageSize }),
    },
    {
      name: "slides_get_presentation",
      description: "Fetch a presentation's full structure.",
      action: "get_presentation",
      schema: {
        type: "object",
        properties: { presentationId: { type: "string" } },
        required: ["presentationId"],
      },
      mapArgs: (a) => ({ presentationId: a.presentationId }),
    },
    {
      name: "slides_create_presentation",
      description: "Create a new Google Slides presentation.",
      action: "create_presentation",
      schema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
      mapArgs: (a) => ({ title: a.title }),
    },
    {
      name: "slides_add_slide",
      description: "Add a new slide to a presentation.",
      action: "add_slide",
      schema: {
        type: "object",
        properties: {
          presentationId: { type: "string" },
          layout: { type: "string", description: "e.g. TITLE, TITLE_AND_BODY, BLANK" },
          insertionIndex: { type: "number" },
        },
        required: ["presentationId"],
      },
      mapArgs: (a) => ({ presentationId: a.presentationId, layout: a.layout, insertionIndex: a.insertionIndex }),
    },
    {
      name: "slides_delete_slide",
      description: "Delete a slide from a presentation.",
      action: "delete_slide",
      schema: {
        type: "object",
        properties: { presentationId: { type: "string" }, objectId: { type: "string" } },
        required: ["presentationId", "objectId"],
      },
      mapArgs: (a) => ({ presentationId: a.presentationId, objectId: a.objectId }),
    },
    {
      name: "slides_replace_text",
      description: "Find-and-replace text across all slides in a presentation.",
      action: "replace_text",
      schema: {
        type: "object",
        properties: {
          presentationId: { type: "string" },
          find: { type: "string" },
          replace: { type: "string" },
          matchCase: { type: "boolean" },
        },
        required: ["presentationId", "find", "replace"],
      },
      mapArgs: (a) => ({ presentationId: a.presentationId, find: a.find, replace: a.replace, matchCase: a.matchCase }),
    },
    {
      name: "slides_batch_update",
      description: "Send a raw batchUpdate requests array to the Slides API.",
      action: "batch_update",
      schema: {
        type: "object",
        properties: {
          presentationId: { type: "string" },
          requests: { type: "array", items: { type: "object" } },
        },
        required: ["presentationId", "requests"],
      },
      mapArgs: (a) => ({ presentationId: a.presentationId, requests: a.requests }),
    },
    {
      name: "slides_export_presentation",
      description: "Export a presentation to PDF / PPTX / etc.",
      action: "export_presentation",
      schema: {
        type: "object",
        properties: {
          presentationId: { type: "string" },
          mimeType: { type: "string", description: "e.g. application/pdf" },
        },
        required: ["presentationId"],
      },
      mapArgs: (a) => ({ presentationId: a.presentationId, mimeType: a.mimeType }),
    },
  ],
};
