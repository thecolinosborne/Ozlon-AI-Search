import type { IntegrationManifest } from "./types.ts";

/**
 * Notion integration — proof of the 30-second integration promise.
 * Auth: env-level NOTION_API_KEY (internal integration token).
 * Envelope: nested ({ action, params }).
 */
export const notionIntegration: IntegrationManifest = {
  id: "notion",
  displayName: "Notion",
  edgeFunction: "notion",
  envelope: "nested",
  tools: [
    {
      name: "notion_search",
      description: "Search the user's Notion workspace for pages or databases by title.",
      action: "search",
      schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Title text to search for. Empty = recent items." },
          filter: {
            type: "string",
            enum: ["page", "database"],
            description: "Restrict results to pages or databases.",
          },
          pageSize: { type: "number", description: "Max results (default 25, max 100)" },
        },
      },
      mapArgs: (a) => ({ query: a.query ?? "", filter: a.filter, pageSize: a.pageSize ?? 25 }),
    },
    {
      name: "notion_get_page",
      description: "Fetch a Notion page's properties + block children by page ID.",
      action: "get_page",
      schema: {
        type: "object",
        properties: { pageId: { type: "string" } },
        required: ["pageId"],
      },
      mapArgs: (a) => ({ pageId: a.pageId }),
    },
    {
      name: "notion_create_page",
      description:
        "Create a new Notion page under a parent page or database. Provide markdown content for the body.",
      action: "create_page",
      schema: {
        type: "object",
        properties: {
          parentId: { type: "string", description: "Parent page or database ID." },
          parentType: { type: "string", enum: ["page", "database"], description: "Parent type (default 'page')." },
          title: { type: "string" },
          markdown: { type: "string", description: "Optional body content as markdown." },
        },
        required: ["parentId", "title"],
      },
      mapArgs: (a) => ({
        parentId: a.parentId,
        parentType: a.parentType ?? "page",
        title: a.title,
        markdown: a.markdown ?? "",
      }),
    },
    {
      name: "notion_append_blocks",
      description: "Append markdown content as new blocks to the bottom of a Notion page.",
      action: "append_blocks",
      schema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          markdown: { type: "string" },
        },
        required: ["pageId", "markdown"],
      },
      mapArgs: (a) => ({ pageId: a.pageId, markdown: a.markdown }),
    },
    {
      name: "notion_query_database",
      description: "Query a Notion database, returning rows (pages) with their properties.",
      action: "query_database",
      schema: {
        type: "object",
        properties: {
          databaseId: { type: "string" },
          pageSize: { type: "number", description: "Max results (default 25, max 100)" },
        },
        required: ["databaseId"],
      },
      mapArgs: (a) => ({ databaseId: a.databaseId, pageSize: a.pageSize ?? 25 }),
    },
  ],
};
