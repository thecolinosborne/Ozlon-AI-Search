import type { IntegrationManifest } from "./types.ts";

export const googleDriveIntegration: IntegrationManifest = {
  id: "google-drive",
  displayName: "Google Drive",
  edgeFunction: "google-drive",
  envelope: "nested",
  tools: [
    {
      name: "drive_list_files",
      description: "List files in the user's Google Drive (with optional Drive query).",
      action: "list_files",
      schema: {
        type: "object",
        properties: {
          q: { type: "string", description: "Drive search query syntax" },
          pageSize: { type: "number" },
          pageToken: { type: "string" },
        },
      },
      mapArgs: (a) => ({ q: a.q, pageSize: a.pageSize, pageToken: a.pageToken }),
    },
    {
      name: "drive_search_files",
      description: "Search Google Drive by name/keyword.",
      action: "search_files",
      schema: {
        type: "object",
        properties: { query: { type: "string" }, pageSize: { type: "number" } },
        required: ["query"],
      },
      mapArgs: (a) => ({ name: a.query, pageSize: a.pageSize }),
    },
    {
      name: "drive_get_file",
      description: "Fetch metadata for a Drive file.",
      action: "get_file",
      schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      mapArgs: (a) => ({ id: a.id }),
    },
    {
      name: "drive_create_folder",
      description: "Create a new folder in Google Drive.",
      action: "create_folder",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          parents: { type: "array", items: { type: "string" } },
        },
        required: ["name"],
      },
      mapArgs: (a) => ({ name: a.name, parents: a.parents }),
    },
    {
      name: "drive_move_file",
      description: "Move a Drive file to a new parent folder.",
      action: "move_file",
      schema: {
        type: "object",
        properties: { id: { type: "string" }, newParentId: { type: "string" } },
        required: ["id", "newParentId"],
      },
      mapArgs: (a) => ({ id: a.id, newParentId: a.newParentId }),
    },
    {
      name: "drive_copy_file",
      description: "Copy a Drive file (optionally renaming).",
      action: "copy_file",
      schema: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id"],
      },
      mapArgs: (a) => ({ id: a.id, name: a.name }),
    },
    {
      name: "drive_rename_file",
      description: "Rename a Drive file.",
      action: "rename_file",
      schema: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"],
      },
      mapArgs: (a) => ({ id: a.id, name: a.name }),
    },
    {
      name: "drive_trash_file",
      description: "Move a Drive file to trash.",
      action: "trash_file",
      schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      mapArgs: (a) => ({ id: a.id }),
    },
    {
      name: "drive_share_file",
      description: "Share a Drive file with a specific person (reader/writer/commenter).",
      action: "share_file",
      schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          emailAddress: { type: "string" },
          role: { type: "string", enum: ["reader", "writer", "commenter"] },
          type: { type: "string", enum: ["user", "group", "domain", "anyone"] },
        },
        required: ["id", "emailAddress", "role"],
      },
      mapArgs: (a) => ({ id: a.id, emailAddress: a.emailAddress, role: a.role, type: a.type ?? "user" }),
    },
    {
      name: "drive_storage_quota",
      description: "Show Google Drive storage usage and quota.",
      action: "get_storage_quota",
      schema: { type: "object", properties: {} },
    },
  ],
};
