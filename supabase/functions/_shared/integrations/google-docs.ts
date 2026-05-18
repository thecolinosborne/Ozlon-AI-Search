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
      description: "Render markdown into a Google Doc with the Apple Memo theme. Supports H1/H2/H3, #### eyebrow labels, **bold**, *italic*, ~~strike~~, `code`, [links](url), > blockquotes, fenced ``` code blocks, --- horizontal rules, nested bullet/numbered lists, and GFM tables. Use replaceAll:true to wipe the doc first. For real deliverables (briefs, reports, memos), prefer docs_apply_styled_document.",
      action: "apply_markdown",
      schema: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          markdown: { type: "string", description: "Full markdown body. Tables, blockquotes, code blocks, horizontal rules and links are all supported." },
          replaceAll: { type: "boolean", description: "If true, wipe existing content first. Default false (append)." },
        },
        required: ["documentId", "markdown"],
      },
      mapArgs: (a) => ({ documentId: a.documentId, markdown: a.markdown, replaceAll: a.replaceAll }),
    },
    {
      name: "docs_apply_styled_document",
      description: "Render a fully themed Apple Memo document in one call. Use this for any real deliverable (brief, report, memo, plan, SOP, proposal). Takes a structured payload (title, subtitle, metadata, executive summary, sections with optional tables/callouts, recommendations, closing line) and renders the complete formatted doc with proper title block, eyebrows, hairline rules between phases, and a closing italic.",
      action: "apply_styled_document",
      schema: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          replaceAll: { type: "boolean", description: "Wipe existing content first. Default true." },
          title: { type: "string" },
          subtitle: { type: "string", description: "One-line italic framing under the title." },
          meta: {
            type: "object",
            description: "Metadata row rendered as 'Date · For · Purpose'.",
            properties: {
              date: { type: "string" },
              for: { type: "string" },
              purpose: { type: "string" },
            },
          },
          executiveSummary: { type: "string", description: "3-4 sentence TL;DR rendered as the first section." },
          sections: {
            type: "array",
            description: "Ordered body sections. Each gets an optional eyebrow label, an H2 heading, optional markdown body, optional table, and optional pull-quote callout. Sections are separated by hairline rules.",
            items: {
              type: "object",
              properties: {
                eyebrow: { type: "string", description: "Small-caps label above the heading, e.g. 'OVERVIEW', 'KEY FINDINGS'." },
                heading: { type: "string" },
                body: { type: "string", description: "Markdown body for the section." },
                table: {
                  type: "object",
                  properties: {
                    headers: { type: "array", items: { type: "string" } },
                    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
                  },
                },
                callout: { type: "string", description: "Single pull-quote rendered as an italic blockquote." },
              },
              required: ["heading"],
            },
          },
          recommendations: {
            type: "array",
            items: { type: "string" },
            description: "Numbered action list at the end of the doc.",
          },
          closing: { type: "string", description: "Single italic closing line." },
        },
        required: ["documentId", "title"],
      },
      mapArgs: (a) => ({
        documentId: a.documentId,
        replaceAll: a.replaceAll,
        title: a.title,
        subtitle: a.subtitle,
        meta: a.meta,
        executiveSummary: a.executiveSummary,
        sections: a.sections,
        recommendations: a.recommendations,
        closing: a.closing,
      }),
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
