import type { IntegrationManifest } from "./types.ts";

export const googleDocsIntegration: IntegrationManifest = {
  id: "google-docs",
  displayName: "Google Docs",
  edgeFunction: "google-docs",
  envelope: "nested",
  tools: [
    {
      name: "docs_list_documents",
      description: "List the user's recent Google Docs.",
      action: "list_documents",
      schema: {
        type: "object",
        properties: { pageSize: { type: "number", description: "Max results (default 25)" } },
      },
      mapArgs: (a) => ({ pageSize: a.pageSize }),
    },
    {
      name: "docs_get_document",
      description: "Fetch the full structure of a Google Doc by ID.",
      action: "get_document",
      schema: {
        type: "object",
        properties: { documentId: { type: "string" } },
        required: ["documentId"],
      },
      mapArgs: (a) => ({ documentId: a.documentId }),
    },
    {
      name: "docs_insert_text",
      description: "Insert raw text into a Google Doc at the given index (default 1, top).",
      action: "insert_text",
      schema: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          text: { type: "string" },
          index: { type: "number", description: "Insertion index (default 1)" },
        },
        required: ["documentId", "text"],
      },
      mapArgs: (a) => ({ documentId: a.documentId, text: a.text, index: a.index ?? 1 }),
    },
    {
      name: "docs_replace_text",
      description: "Find-and-replace text inside a Google Doc.",
      action: "replace_text",
      schema: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          find: { type: "string" },
          replaceText: { type: "string" },
        },
        required: ["documentId", "find", "replaceText"],
      },
      mapArgs: (a) => ({ documentId: a.documentId, find: a.find, replaceText: a.replaceText }),
    },
    {
      name: "docs_apply_markdown",
      description: "Apply a markdown body to a Google Doc, with optional full-replace.",
      action: "apply_markdown",
      schema: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          markdown: { type: "string" },
          replaceAll: { type: "boolean" },
        },
        required: ["documentId", "markdown"],
      },
      mapArgs: (a) => ({ documentId: a.documentId, markdown: a.markdown, replaceAll: a.replaceAll }),
    },
    {
      name: "docs_format_as_report",
      description: "Apply professional report formatting (headings, spacing) to a Google Doc.",
      action: "format_as_report",
      schema: {
        type: "object",
        properties: { documentId: { type: "string" } },
        required: ["documentId"],
      },
      mapArgs: (a) => ({ documentId: a.documentId }),
    },
    {
      name: "docs_style_range",
      description: "Style a character range in a Google Doc (bold, italic, color, link, font size).",
      action: "style_range",
      schema: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          startIndex: { type: "number" },
          endIndex: { type: "number" },
          bold: { type: "boolean" },
          italic: { type: "boolean" },
          fontSize: { type: "number" },
          foregroundColor: { type: "string" },
          link: { type: "string" },
        },
        required: ["documentId", "startIndex", "endIndex"],
      },
      mapArgs: (a) => ({ ...a }),
    },
    {
      name: "docs_clear_formatting",
      description: "Clear formatting on a character range in a Google Doc.",
      action: "clear_formatting",
      schema: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          startIndex: { type: "number" },
          endIndex: { type: "number" },
        },
        required: ["documentId", "startIndex", "endIndex"],
      },
      mapArgs: (a) => ({ documentId: a.documentId, startIndex: a.startIndex, endIndex: a.endIndex }),
    },
    {
      name: "docs_batch_update",
      description: "Send a raw batchUpdate requests array to the Google Docs API.",
      action: "batch_update",
      schema: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          requests: { type: "array", items: { type: "object" } },
        },
        required: ["documentId", "requests"],
      },
      mapArgs: (a) => ({ documentId: a.documentId, requests: a.requests }),
    },
  ],
};
