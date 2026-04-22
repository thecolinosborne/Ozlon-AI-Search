import type { IntegrationManifest } from "./types.ts";

export const googleSheetsIntegration: IntegrationManifest = {
  id: "google-sheets",
  displayName: "Google Sheets",
  edgeFunction: "google-sheets",
  envelope: "nested",
  tools: [
    {
      name: "sheets_list_spreadsheets",
      description: "List the user's Google Sheets.",
      action: "list_spreadsheets",
      schema: { type: "object", properties: { pageSize: { type: "number" } } },
      mapArgs: (a) => ({ pageSize: a.pageSize }),
    },
    {
      name: "sheets_get_spreadsheet",
      description: "Fetch metadata + sheet list for a spreadsheet.",
      action: "get_spreadsheet",
      schema: {
        type: "object",
        properties: { spreadsheetId: { type: "string" } },
        required: ["spreadsheetId"],
      },
      mapArgs: (a) => ({ spreadsheetId: a.spreadsheetId }),
    },
    {
      name: "sheets_read_range",
      description: "Read a range of cells (e.g. 'Sheet1!A1:D20').",
      action: "read_range",
      schema: {
        type: "object",
        properties: {
          spreadsheetId: { type: "string" },
          range: { type: "string" },
          valueRenderOption: { type: "string", enum: ["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"] },
        },
        required: ["spreadsheetId", "range"],
      },
      mapArgs: (a) => ({ spreadsheetId: a.spreadsheetId, range: a.range, valueRenderOption: a.valueRenderOption }),
    },
    {
      name: "sheets_write_range",
      description: "Write a 2D array of values to a range, overwriting existing cells.",
      action: "write_range",
      schema: {
        type: "object",
        properties: {
          spreadsheetId: { type: "string" },
          range: { type: "string" },
          values: {
            type: "array",
            description: "Rows of cell values; each row is an array of strings/numbers.",
            items: { type: "array", items: { type: "string" } },
          },
          valueInputOption: { type: "string", enum: ["RAW", "USER_ENTERED"] },
        },
        required: ["spreadsheetId", "range", "values"],
      },
      mapArgs: (a) => ({ spreadsheetId: a.spreadsheetId, range: a.range, values: a.values, valueInputOption: a.valueInputOption }),
    },
    {
      name: "sheets_append_rows",
      description: "Append rows to a sheet/range.",
      action: "append_rows",
      schema: {
        type: "object",
        properties: {
          spreadsheetId: { type: "string" },
          range: { type: "string" },
          values: {
            type: "array",
            description: "Rows of cell values; each row is an array of strings/numbers.",
            items: { type: "array", items: { type: "string" } },
          },
        },
        required: ["spreadsheetId", "range", "values"],
      },
      mapArgs: (a) => ({ spreadsheetId: a.spreadsheetId, range: a.range, values: a.values }),
    },
    {
      name: "sheets_clear_range",
      description: "Clear all values in a range.",
      action: "clear_range",
      schema: {
        type: "object",
        properties: { spreadsheetId: { type: "string" }, range: { type: "string" } },
        required: ["spreadsheetId", "range"],
      },
      mapArgs: (a) => ({ spreadsheetId: a.spreadsheetId, range: a.range }),
    },
    {
      name: "sheets_create_spreadsheet",
      description: "Create a new spreadsheet.",
      action: "create_spreadsheet",
      schema: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
      mapArgs: (a) => ({ title: a.title }),
    },
    {
      name: "sheets_add_sheet",
      description: "Add a new tab to an existing spreadsheet.",
      action: "add_sheet",
      schema: {
        type: "object",
        properties: { spreadsheetId: { type: "string" }, title: { type: "string" } },
        required: ["spreadsheetId", "title"],
      },
      mapArgs: (a) => ({ spreadsheetId: a.spreadsheetId, title: a.title }),
    },
    {
      name: "sheets_batch_update",
      description: "Send a raw batchUpdate requests array to the Sheets API.",
      action: "batch_update",
      schema: {
        type: "object",
        properties: {
          spreadsheetId: { type: "string" },
          requests: { type: "array", items: { type: "object" } },
        },
        required: ["spreadsheetId", "requests"],
      },
      mapArgs: (a) => ({ spreadsheetId: a.spreadsheetId, requests: a.requests }),
    },
  ],
};
