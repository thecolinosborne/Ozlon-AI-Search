// ClickUp integration manifest — 35 pass-through tools.
// Receiver (supabase/functions/clickup/index.ts) reads { action, params } (nested envelope).
// Migrated from chat/index.ts legacy switch (Apr 2026).

import type { IntegrationManifest } from "./types.ts";

// ---- Reusable schema fragments ----
const taskIdSchema = { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] };
const checklistOnly = { type: "object", properties: { checklist_id: { type: "string" } }, required: ["checklist_id"] };
const noArgs = { type: "object", properties: {}, required: [] };

export const clickupIntegration: IntegrationManifest = {
  id: "clickup",
  displayName: "ClickUp",
  edgeFunction: "clickup",
  envelope: "nested",
  tools: [
    // ---- Task CRUD ----
    {
      name: "create_clickup_task",
      action: "create_task",
      description: "Create a new task in ClickUp. The list_id is optional — if omitted, the configured default list is used.",
      schema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          priority: { type: "number", description: "1=Urgent, 2=High, 3=Normal, 4=Low" },
        },
        required: ["name"],
      },
      mapArgs: (a) => {
        const p: Record<string, unknown> = { name: a.name };
        if (a.list_id) p.listId = a.list_id;
        if (a.description) p.description = a.description;
        if (a.priority) p.priority = a.priority;
        return p;
      },
    },
    {
      name: "list_clickup_tasks",
      action: "list_tasks",
      description: "List tasks from a ClickUp list. If list_id is omitted, uses the configured default list. Set subtasks=true to include subtasks in the results (needed when the user asks about subtasks of a task).",
      schema: {
        type: "object",
        properties: {
          list_id: { type: "string" },
          subtasks: { type: "boolean", description: "Include subtasks in the response." },
        },
        required: [],
      },
      mapArgs: (a) => {
        const p: Record<string, unknown> = {};
        if (a.list_id) p.listId = a.list_id;
        if (a.subtasks) p.subtasks = true;
        return p;
      },
    },
    {
      name: "get_clickup_task",
      action: "get_task",
      description: "Get full details of a ClickUp task by ID.",
      schema: taskIdSchema,
      mapArgs: (a) => ({ taskId: a.task_id }),
    },
    {
      name: "update_clickup_task",
      action: "update_task",
      description: "Update an existing ClickUp task (name, description, priority).",
      schema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          priority: { type: "number" },
        },
        required: ["task_id"],
      },
      mapArgs: (a) => {
        const p: Record<string, unknown> = { taskId: a.task_id };
        if (a.name) p.name = a.name;
        if (a.description) p.description = a.description;
        if (a.priority) p.priority = a.priority;
        return p;
      },
    },
    {
      name: "delete_clickup_task",
      action: "delete_task",
      description: "Delete a ClickUp task permanently.",
      schema: taskIdSchema,
      mapArgs: (a) => ({ taskId: a.task_id }),
    },
    {
      name: "upload_clickup_task_attachment",
      action: "upload_task_attachment",
      description: "Upload a file as an attachment on a ClickUp task. Provide the task_id, filename, mimeType, and base64-encoded file data. Use this to attach files (PDFs, images, docs) pulled from Gmail or other sources directly onto a ClickUp task.",
      sideEffect: "write",
      schema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          filename: { type: "string" },
          mimeType: { type: "string" },
          dataBase64: { type: "string", description: "Base64-encoded file bytes (standard or base64url)." },
          source_message_id: { type: "string", description: "Optional Gmail message ID to pull the attachment from server-side." },
          source_attachment_id: { type: "string", description: "Optional Gmail attachment ID to pull server-side with source_message_id." },
        },
        required: ["task_id", "filename"],
      },
      mapArgs: (a) => ({
        taskId: a.task_id,
        filename: a.filename,
        mimeType: a.mimeType || "application/octet-stream",
        dataBase64: a.dataBase64,
        source_message_id: a.source_message_id,
        source_attachment_id: a.source_attachment_id,
      }),
    },
    {
      name: "set_clickup_task_status",
      action: "set_task_status",
      description: "Change the status of a ClickUp task (e.g. 'open', 'in progress', 'complete').",
      schema: { type: "object", properties: { task_id: { type: "string" }, status: { type: "string" } }, required: ["task_id", "status"] },
      mapArgs: (a) => ({ taskId: a.task_id, status: a.status }),
    },
    {
      name: "set_clickup_due_date",
      action: "set_due_date",
      description: "Set or clear a due date on a ClickUp task. Pass Unix timestamp in ms.",
      schema: { type: "object", properties: { task_id: { type: "string" }, due_date: { type: "number" } }, required: ["task_id"] },
      mapArgs: (a) => ({ taskId: a.task_id, due_date: a.due_date ?? null }),
    },
    {
      name: "set_clickup_assignees",
      action: "set_assignees",
      description: "Add or remove assignees on a ClickUp task.",
      schema: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          add: { type: "array", items: { type: "number" } },
          rem: { type: "array", items: { type: "number" } },
        },
        required: ["task_id"],
      },
      mapArgs: (a) => ({ taskId: a.task_id, add: a.add || [], rem: a.rem || [] }),
    },
    {
      name: "create_clickup_subtask",
      action: "create_subtask",
      description: "Create a subtask under a parent ClickUp task.",
      schema: {
        type: "object",
        properties: { parent_id: { type: "string" }, name: { type: "string" }, description: { type: "string" } },
        required: ["parent_id", "name"],
      },
      mapArgs: (a) => {
        const p: Record<string, unknown> = { parentId: a.parent_id, name: a.name };
        if (a.description) p.description = a.description;
        return p;
      },
    },
    {
      name: "move_clickup_task",
      action: "move_task",
      description: "Move a ClickUp task to a different list.",
      schema: { type: "object", properties: { task_id: { type: "string" }, list_id: { type: "string" } }, required: ["task_id", "list_id"] },
      mapArgs: (a) => ({ taskId: a.task_id, listId: a.list_id }),
    },
    {
      name: "set_clickup_priority",
      action: "update_task",
      description: "Set the priority of a ClickUp task. 1=Urgent, 2=High, 3=Normal, 4=Low.",
      schema: { type: "object", properties: { task_id: { type: "string" }, priority: { type: "number" } }, required: ["task_id", "priority"] },
      mapArgs: (a) => ({ taskId: a.task_id, priority: a.priority }),
    },

    // ---- Comments ----
    {
      name: "create_clickup_comment",
      action: "create_comment",
      description: "Add a comment to a ClickUp task.",
      schema: { type: "object", properties: { task_id: { type: "string" }, comment_text: { type: "string" } }, required: ["task_id", "comment_text"] },
      mapArgs: (a) => ({ taskId: a.task_id, comment_text: a.comment_text }),
    },
    {
      name: "list_clickup_comments",
      action: "list_comments",
      description: "List comments on a ClickUp task.",
      schema: taskIdSchema,
      mapArgs: (a) => ({ taskId: a.task_id }),
    },
    {
      name: "update_clickup_comment",
      action: "update_comment",
      description: "Edit an existing comment in ClickUp.",
      schema: { type: "object", properties: { comment_id: { type: "string" }, comment_text: { type: "string" } }, required: ["comment_id", "comment_text"] },
      mapArgs: (a) => ({ commentId: a.comment_id, comment_text: a.comment_text }),
    },
    {
      name: "delete_clickup_comment",
      action: "delete_comment",
      description: "Delete a comment from ClickUp.",
      schema: { type: "object", properties: { comment_id: { type: "string" } }, required: ["comment_id"] },
      mapArgs: (a) => ({ commentId: a.comment_id }),
    },

    // ---- Tags ----
    {
      name: "add_clickup_tag",
      action: "add_tag",
      description: "Add a tag to a ClickUp task.",
      schema: { type: "object", properties: { task_id: { type: "string" }, tag: { type: "string" } }, required: ["task_id", "tag"] },
      mapArgs: (a) => ({ taskId: a.task_id, tag: a.tag }),
    },
    {
      name: "remove_clickup_tag",
      action: "remove_tag",
      description: "Remove a tag from a ClickUp task.",
      schema: { type: "object", properties: { task_id: { type: "string" }, tag: { type: "string" } }, required: ["task_id", "tag"] },
      mapArgs: (a) => ({ taskId: a.task_id, tag: a.tag }),
    },

    // ---- Checklists ----
    {
      name: "create_clickup_checklist",
      action: "create_checklist",
      description: "Add a checklist to a ClickUp task.",
      schema: { type: "object", properties: { task_id: { type: "string" }, name: { type: "string" } }, required: ["task_id", "name"] },
      mapArgs: (a) => ({ taskId: a.task_id, name: a.name }),
    },
    {
      name: "create_clickup_checklist_item",
      action: "create_checklist_item",
      description: "Add an item to an existing ClickUp checklist.",
      schema: { type: "object", properties: { checklist_id: { type: "string" }, name: { type: "string" } }, required: ["checklist_id", "name"] },
      mapArgs: (a) => ({ checklistId: a.checklist_id, name: a.name }),
    },
    {
      name: "update_clickup_checklist_item",
      action: "update_checklist_item",
      description: "Toggle resolved or rename a checklist item.",
      schema: {
        type: "object",
        properties: {
          checklist_id: { type: "string" },
          checklist_item_id: { type: "string" },
          name: { type: "string" },
          resolved: { type: "boolean" },
        },
        required: ["checklist_id", "checklist_item_id"],
      },
      mapArgs: (a) => {
        const p: Record<string, unknown> = { checklistId: a.checklist_id, itemId: a.checklist_item_id };
        if (a.name) p.name = a.name;
        if (a.resolved !== undefined) p.resolved = a.resolved;
        return p;
      },
    },
    {
      name: "delete_clickup_checklist",
      action: "delete_checklist",
      description: "Delete an entire checklist from a ClickUp task.",
      schema: checklistOnly,
      mapArgs: (a) => ({ checklistId: a.checklist_id }),
    },
    {
      name: "delete_clickup_checklist_item",
      action: "delete_checklist_item",
      description: "Delete an item from a ClickUp checklist.",
      schema: { type: "object", properties: { checklist_id: { type: "string" }, checklist_item_id: { type: "string" } }, required: ["checklist_id", "checklist_item_id"] },
      mapArgs: (a) => ({ checklistId: a.checklist_id, checklistItemId: a.checklist_item_id }),
    },

    // ---- Discovery / search ----
    {
      name: "search_clickup_tasks",
      action: "search_tasks",
      description: "Search tasks across the entire ClickUp workspace by keyword, status, assignee, tags, or due date.",
      schema: {
        type: "object",
        properties: {
          statuses: { type: "array", items: { type: "string" } },
          assignees: { type: "array", items: { type: "number" } },
          tags: { type: "array", items: { type: "string" } },
          due_date_gt: { type: "number" },
          due_date_lt: { type: "number" },
          include_closed: { type: "boolean" },
          subtasks: { type: "boolean" },
        },
        required: [],
      },
      mapArgs: (a) => {
        const p: Record<string, unknown> = {};
        if (a.statuses) p.statuses = a.statuses;
        if (a.assignees) p.assignees = a.assignees;
        if (a.tags) p.tags = a.tags;
        if (a.due_date_gt) p.due_date_gt = a.due_date_gt;
        if (a.due_date_lt) p.due_date_lt = a.due_date_lt;
        if (a.include_closed) p.include_closed = true;
        if (a.subtasks) p.subtasks = true;
        return p;
      },
    },
    {
      name: "list_clickup_spaces",
      action: "list_spaces",
      description: "List all spaces in the ClickUp workspace.",
      schema: noArgs,
    },
    {
      name: "list_clickup_lists",
      action: "list_all_lists",
      description: "List all lists across the entire ClickUp workspace (all spaces and folders).",
      schema: noArgs,
    },
    {
      name: "list_clickup_members",
      action: "list_workspace_members",
      description: "List all members in the ClickUp workspace. Use to discover user IDs for assignee operations.",
      schema: noArgs,
    },
    {
      name: "get_clickup_list_statuses",
      action: "get_list_statuses",
      description: "Get available statuses for a ClickUp list. Useful to know valid status values before setting task status.",
      schema: { type: "object", properties: { list_id: { type: "string" } }, required: ["list_id"] },
      mapArgs: (a) => ({ listId: a.list_id }),
    },

    // ---- Time tracking ----
    {
      name: "start_clickup_timer",
      action: "start_time_entry",
      description: "Start a time tracking timer on a ClickUp task.",
      schema: { type: "object", properties: { task_id: { type: "string" }, description: { type: "string" } }, required: ["task_id"] },
      mapArgs: (a) => ({ taskId: a.task_id, description: a.description || "" }),
    },
    {
      name: "stop_clickup_timer",
      action: "stop_time_entry",
      description: "Stop the currently running ClickUp time tracking timer.",
      schema: noArgs,
    },
    {
      name: "get_clickup_time_entries",
      action: "get_time_entries",
      description: "Get time tracking entries from ClickUp.",
      schema: { type: "object", properties: { start_date: { type: "number" }, end_date: { type: "number" } }, required: [] },
      mapArgs: (a) => {
        const p: Record<string, unknown> = {};
        if (a.start_date) p.start_date = a.start_date;
        if (a.end_date) p.end_date = a.end_date;
        return p;
      },
    },

    // ---- Custom fields ----
    {
      name: "get_clickup_custom_fields",
      action: "get_custom_fields",
      description: "List custom fields available on a ClickUp list.",
      schema: { type: "object", properties: { list_id: { type: "string" } }, required: ["list_id"] },
      mapArgs: (a) => ({ listId: a.list_id }),
    },
    {
      name: "set_clickup_custom_field",
      action: "set_custom_field",
      description: "Set a custom field value on a ClickUp task.",
      schema: {
        type: "object",
        properties: { task_id: { type: "string" }, field_id: { type: "string" }, value: {} },
        required: ["task_id", "field_id", "value"],
      },
      mapArgs: (a) => ({ taskId: a.task_id, fieldId: a.field_id, value: a.value }),
    },
    {
      name: "create_clickup_custom_field",
      action: "create_custom_field",
      description: "Create a NEW custom field (schema) on a ClickUp list. Use this instead of telling the user to create fields manually. Types: text, number, date, drop_down, labels, checkbox, url, email, phone, rating. ClickUp has NO currency field — request type 'money' and it is auto-mapped to a number field with 2-decimal precision and a '($)' label suffix.",
      sideEffect: "write",
      schema: {
        type: "object",
        properties: {
          list_id: { type: "string", description: "Optional — defaults to the configured list." },
          name: { type: "string" },
          type: { type: "string", description: "text | number | date | drop_down | labels | checkbox | url | email | phone | rating | money (money is auto-mapped to a formatted number field)" },

          type_config: { type: "object", description: "For drop_down/labels pass { options: [{ name: 'Option A' }] }." },
        },
        required: ["name", "type"],
      },
      mapArgs: (a) => {
        const p: Record<string, unknown> = { name: a.name, type: a.type };
        if (a.list_id) p.listId = a.list_id;
        if (a.type_config) p.type_config = a.type_config;
        return p;
      },
    },
    {
      name: "ensure_clickup_custom_fields",
      action: "ensure_custom_fields",
      description: "Idempotently make sure a set of custom fields exists on a ClickUp list — creates missing ones, reuses existing ones by name, and returns every field_id ready for set_clickup_custom_field. Use this when the user asks for several fields at once.",
      sideEffect: "write",
      schema: {
        type: "object",
        properties: {
          list_id: { type: "string", description: "Optional — defaults to the configured list." },
          fields: {
            type: "array",
            description: "Fields to ensure.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string" },
                type_config: { type: "object" },
              },
              required: ["name", "type"],
            },
          },
        },
        required: ["fields"],
      },
      mapArgs: (a) => {
        const p: Record<string, unknown> = { fields: a.fields };
        if (a.list_id) p.listId = a.list_id;
        return p;
      },
    },
    {
      name: "delete_clickup_custom_field",
      action: "delete_custom_field",
      description: "Delete a custom field from a ClickUp list. Destructive — confirm with the user first.",
      sideEffect: "destructive",
      schema: {
        type: "object",
        properties: { list_id: { type: "string" }, field_id: { type: "string" } },
        required: ["field_id"],
      },
      mapArgs: (a) => {
        const p: Record<string, unknown> = { fieldId: a.field_id };
        if (a.list_id) p.listId = a.list_id;
        return p;
      },
    },


    // ---- Dependencies ----
    {
      name: "list_clickup_task_dependencies",
      action: "get_task_dependencies",
      description: "List dependencies and dependents of a ClickUp task.",
      schema: taskIdSchema,
      mapArgs: (a) => ({ taskId: a.task_id }),
    },
    {
      name: "add_clickup_dependency",
      action: "add_dependency",
      description: "Add a dependency between two ClickUp tasks (task depends on another).",
      schema: { type: "object", properties: { task_id: { type: "string" }, depends_on: { type: "string" } }, required: ["task_id", "depends_on"] },
      mapArgs: (a) => ({ taskId: a.task_id, depends_on: a.depends_on }),
    },
    {
      name: "delete_clickup_dependency",
      action: "delete_dependency",
      description: "Remove a dependency between two ClickUp tasks.",
      schema: { type: "object", properties: { task_id: { type: "string" }, depends_on: { type: "string" } }, required: ["task_id", "depends_on"] },
      mapArgs: (a) => ({ taskId: a.task_id, depends_on: a.depends_on }),
    },
  ],
};
