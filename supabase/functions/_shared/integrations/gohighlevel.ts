// GoHighLevel pilot manifest — 18 high-utility tools.
// Pilot scope: Social Planner, Conversations, Opportunities, Contacts (core).
//
// Receiver: supabase/functions/gohighlevel/index.ts destructures
// `{ action, path, body, method, params }` from req JSON. We use the FLAT
// envelope and have each tool return `{ params, body, method }` from mapArgs
// so the receiver picks the right slots without changes.
//
// Credentials are resolved per-user inside the GHL edge function via the
// forwarded JWT, so the dispatcher needs no extra context plumbing.

import type { IntegrationManifest, ToolFormatter } from "./types.ts";
import { formatList, formatReceipt } from "./_formatters.ts";

// ---------- Reusable formatters ----------
const fmtContacts: ToolFormatter = (data) =>
  formatList(data, "contacts", { title: "contactName", sub: "email", meta: "id" }, { label: "contacts" });

const fmtOpportunities: ToolFormatter = (data) =>
  formatList(data, "opportunities", { title: "name", sub: "status", meta: "monetaryValue" }, { label: "opportunities" });

const fmtPipelines: ToolFormatter = (data) =>
  formatList(data, "pipelines", { title: "name", meta: "id" }, { label: "pipelines" });

const fmtConversations: ToolFormatter = (data) =>
  formatList(data, "conversations", { title: "contactName", sub: "lastMessageBody", meta: "id" }, { label: "conversations" });

const fmtMessages: ToolFormatter = (data) =>
  formatList(data, "messages.messages", { title: "type", sub: "body", meta: "dateAdded" }, { label: "messages" });

const fmtSocialAccounts: ToolFormatter = (data) =>
  formatList(data, "results.accounts", { title: "name", sub: "platform", meta: "id" }, { label: "social accounts" });

const fmtSocialPosts: ToolFormatter = (data) =>
  formatList(data, "posts", { title: "summary", sub: "status", meta: "scheduleDate" }, { label: "social posts" });

const fmtMediaFiles: ToolFormatter = (data) =>
  formatList(data, "files", { title: "name", sub: "url", meta: "id" }, { label: "media files" });

// ---------- Manifest ----------
export const goHighLevelIntegration: IntegrationManifest = {
  id: "gohighlevel",
  displayName: "GoHighLevel",
  edgeFunction: "gohighlevel",
  envelope: "flat", // mapArgs returns top-level { params, body, method }
  tools: [
    // ============ CONTACTS (core) ============
    {
      name: "ghl_list_contacts",
      action: "list_contacts",
      description: "List contacts in GoHighLevel. Optional `query` for name/email/phone search and `limit`.",
      schema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", description: "Default 20" },
        },
        required: [],
      },
      mapArgs: (a) => ({ params: { query: a.query, limit: a.limit } }),
      formatter: fmtContacts,
      sideEffect: "read",
      cost: "cheap",
    },
    {
      name: "ghl_get_contact",
      action: "get_contact",
      description: "Get a single GoHighLevel contact by ID.",
      schema: {
        type: "object",
        properties: { contactId: { type: "string" } },
        required: ["contactId"],
      },
      mapArgs: (a) => ({ params: { contactId: a.contactId } }),
      sideEffect: "read",
      cost: "cheap",
    },
    {
      name: "ghl_search_contacts",
      action: "search_contacts",
      description: "Search GoHighLevel contacts by query string.",
      schema: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
      mapArgs: (a) => ({ params: { query: a.query, limit: a.limit } }),
      formatter: fmtContacts,
      sideEffect: "read",
      cost: "cheap",
    },
    {
      name: "ghl_create_contact",
      action: "create_contact",
      description: "Create a new GoHighLevel contact. Requires firstName + (email or phone).",
      schema: {
        type: "object",
        properties: {
          firstName: { type: "string" },
          lastName: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          source: { type: "string" },
        },
        required: ["firstName"],
      },
      mapArgs: (a) => ({
        body: {
          firstName: a.firstName,
          lastName: a.lastName,
          email: a.email,
          phone: a.phone,
          tags: a.tags,
          source: a.source,
        },
      }),
      formatter: (data) => formatReceipt(data, "Created contact (id: {contact.id})"),
      sideEffect: "write",
      cost: "cheap",
    },
    {
      name: "ghl_update_contact",
      action: "update_contact",
      description: "Update an existing GoHighLevel contact.",
      schema: {
        type: "object",
        properties: {
          contactId: { type: "string" },
          firstName: { type: "string" },
          lastName: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["contactId"],
      },
      mapArgs: (a) => {
        const body: Record<string, unknown> = {};
        for (const k of ["firstName", "lastName", "email", "phone", "tags"]) {
          if (a[k] !== undefined) body[k] = a[k];
        }
        return { params: { contactId: a.contactId }, body };
      },
      formatter: (data) => formatReceipt(data, "Updated contact (id: {contact.id})"),
      sideEffect: "write",
      cost: "cheap",
    },
    {
      name: "ghl_add_tags",
      action: "add_tag",
      description: "Add tags to a GoHighLevel contact.",
      schema: {
        type: "object",
        properties: {
          contactId: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["contactId", "tags"],
      },
      mapArgs: (a) => ({ params: { contactId: a.contactId }, body: { tags: a.tags } }),
      sideEffect: "write",
      cost: "free",
    },
    {
      name: "ghl_add_contact_note",
      action: "add_contact_note",
      description: "Attach a note to a GoHighLevel contact.",
      schema: {
        type: "object",
        properties: {
          contactId: { type: "string" },
          body: { type: "string", description: "The note text." },
        },
        required: ["contactId", "body"],
      },
      mapArgs: (a) => ({ params: { contactId: a.contactId }, body: { body: a.body } }),
      sideEffect: "write",
      cost: "free",
    },

    // ============ OPPORTUNITIES ============
    {
      name: "ghl_list_pipelines",
      action: "list_pipelines",
      description: "List GoHighLevel sales pipelines and their stages. Always call first when working with opportunities.",
      schema: { type: "object", properties: {}, required: [] },
      mapArgs: () => ({}),
      formatter: fmtPipelines,
      sideEffect: "read",
      cost: "free",
    },
    {
      name: "ghl_list_opportunities",
      action: "list_opportunities",
      description: "List GoHighLevel opportunities. Optional pipeline_id filter.",
      schema: {
        type: "object",
        properties: {
          pipeline_id: { type: "string" },
          limit: { type: "number" },
        },
        required: [],
      },
      mapArgs: (a) => ({ params: { pipeline_id: a.pipeline_id, limit: a.limit } }),
      formatter: fmtOpportunities,
      sideEffect: "read",
      cost: "cheap",
    },
    {
      name: "ghl_create_opportunity",
      action: "create_opportunity",
      description: "Create a GoHighLevel opportunity in a pipeline stage.",
      schema: {
        type: "object",
        properties: {
          pipelineId: { type: "string" },
          pipelineStageId: { type: "string" },
          name: { type: "string" },
          contactId: { type: "string" },
          monetaryValue: { type: "number" },
          status: { type: "string", description: "open | won | lost | abandoned" },
        },
        required: ["pipelineId", "pipelineStageId", "name", "contactId"],
      },
      mapArgs: (a) => ({
        body: {
          pipelineId: a.pipelineId,
          pipelineStageId: a.pipelineStageId,
          name: a.name,
          contactId: a.contactId,
          monetaryValue: a.monetaryValue,
          status: a.status ?? "open",
        },
      }),
      formatter: (data) => formatReceipt(data, "Created opportunity {opportunity.name} (id: {opportunity.id})"),
      sideEffect: "write",
      cost: "cheap",
    },
    {
      name: "ghl_update_opportunity",
      action: "update_opportunity",
      description: "Update an existing GoHighLevel opportunity (name, stage, status, value).",
      schema: {
        type: "object",
        properties: {
          opportunityId: { type: "string" },
          name: { type: "string" },
          pipelineStageId: { type: "string" },
          status: { type: "string" },
          monetaryValue: { type: "number" },
        },
        required: ["opportunityId"],
      },
      mapArgs: (a) => {
        const body: Record<string, unknown> = {};
        for (const k of ["name", "pipelineStageId", "status", "monetaryValue"]) {
          if (a[k] !== undefined) body[k] = a[k];
        }
        return { params: { opportunityId: a.opportunityId }, body };
      },
      sideEffect: "write",
      cost: "cheap",
    },

    // ============ CONVERSATIONS / MESSAGES ============
    {
      name: "ghl_list_conversations",
      action: "list_conversations",
      description: "List recent conversations in GoHighLevel. Returns conversation IDs to use with messages.",
      schema: {
        type: "object",
        properties: { limit: { type: "number" } },
        required: [],
      },
      mapArgs: (a) => ({ params: { limit: a.limit } }),
      formatter: fmtConversations,
      sideEffect: "read",
      cost: "cheap",
    },
    {
      name: "ghl_get_conversation_messages",
      action: "get_conversation_messages",
      description: "Get messages from a GoHighLevel conversation.",
      schema: {
        type: "object",
        properties: { conversationId: { type: "string" } },
        required: ["conversationId"],
      },
      mapArgs: (a) => ({ params: { conversationId: a.conversationId } }),
      formatter: fmtMessages,
      sideEffect: "read",
      cost: "cheap",
    },
    {
      name: "ghl_send_message",
      action: "send_message",
      description: "Send a message via GoHighLevel. type: SMS | Email | WhatsApp | IG | FB | Custom. Optionally schedule with `scheduledTimestamp` (ms epoch).",
      schema: {
        type: "object",
        properties: {
          type: { type: "string", description: "SMS | Email | WhatsApp | IG | FB | Custom" },
          contactId: { type: "string" },
          message: { type: "string", description: "Body for SMS / IG / FB / WhatsApp." },
          html: { type: "string", description: "HTML body for Email." },
          subject: { type: "string", description: "Email subject (Email only)." },
          attachments: { type: "array", items: { type: "string" }, description: "Public URLs of media to attach." },
          scheduledTimestamp: { type: "number", description: "Unix ms — schedule for the future." },
        },
        required: ["type", "contactId"],
      },
      mapArgs: (a) => {
        const body: Record<string, unknown> = {
          type: a.type,
          contactId: a.contactId,
        };
        if (a.message !== undefined) body.message = a.message;
        if (a.html !== undefined) body.html = a.html;
        if (a.subject !== undefined) body.subject = a.subject;
        if (a.attachments !== undefined) body.attachments = a.attachments;
        if (a.scheduledTimestamp !== undefined) body.scheduledTimestamp = a.scheduledTimestamp;
        return { body };
      },
      formatter: (data, args) =>
        formatReceipt(data, args.scheduledTimestamp ? "Scheduled {type} message (id: {messageId})" : "Sent {type} message (id: {messageId})"),
      sideEffect: "destructive", // sends real comms — confirm before firing
      cost: "cheap",
      requiresConfirmation: true,
    },

    // ============ SOCIAL PLANNER ============
    {
      name: "ghl_list_social_accounts",
      action: "list_social_accounts",
      description: "List connected social accounts (FB, IG, Google, LinkedIn, Twitter, TikTok) in the GHL Social Planner.",
      schema: { type: "object", properties: {}, required: [] },
      mapArgs: () => ({}),
      formatter: fmtSocialAccounts,
      sideEffect: "read",
      cost: "free",
    },
    {
      name: "ghl_list_social_posts",
      action: "list_social_posts",
      description: "List GHL Social Planner posts. Filter by type: all | scheduled | posted | failed | in_review.",
      schema: {
        type: "object",
        properties: {
          type: { type: "string" },
          accountIds: { type: "array", items: { type: "string" } },
          limit: { type: "number" },
          skip: { type: "number" },
        },
        required: [],
      },
      mapArgs: (a) => ({
        body: {
          type: a.type ?? "all",
          accountIds: a.accountIds ?? [],
          limit: a.limit ?? 20,
          skip: a.skip ?? 0,
        },
      }),
      formatter: fmtSocialPosts,
      sideEffect: "read",
      cost: "cheap",
    },
    {
      name: "ghl_create_social_post",
      action: "create_social_post",
      description: "Schedule or publish a social post via the GHL Social Planner across one or more connected accounts. Use ghl_list_social_accounts first to get accountIds. Media attachments must be public URLs (use ghl_upload_media first if you have a file).",
      schema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Post caption / body text." },
          accountIds: { type: "array", items: { type: "string" }, description: "Required — IDs from ghl_list_social_accounts." },
          scheduleDate: { type: "string", description: "ISO timestamp; omit to publish immediately." },
          status: { type: "string", description: "scheduled | draft | inReview" },
          type: { type: "string", description: "post | reel | story (platform-dependent)" },
          mediaUrls: { type: "array", items: { type: "string" }, description: "Public image/video URLs." },
        },
        required: ["summary", "accountIds"],
      },
      mapArgs: (a) => {
        const media = Array.isArray(a.mediaUrls)
          ? (a.mediaUrls as string[]).map((url) => ({ url, type: "image" }))
          : undefined;
        const body: Record<string, unknown> = {
          summary: a.summary,
          accountIds: a.accountIds,
          status: a.status ?? (a.scheduleDate ? "scheduled" : "scheduled"),
        };
        if (a.scheduleDate !== undefined) body.scheduleDate = a.scheduleDate;
        if (a.type !== undefined) body.type = a.type;
        if (media) body.media = media;
        return { body };
      },
      formatter: (data) => formatReceipt(data, "Created social post (id: {post._id})"),
      sideEffect: "destructive", // publishes externally — confirm
      cost: "cheap",
      requiresConfirmation: true,
    },
    {
      name: "ghl_edit_social_post",
      action: "edit_social_post",
      description: "Edit an existing GHL social post (caption, schedule, status, media).",
      schema: {
        type: "object",
        properties: {
          postId: { type: "string" },
          summary: { type: "string" },
          scheduleDate: { type: "string" },
          status: { type: "string" },
          mediaUrls: { type: "array", items: { type: "string" } },
        },
        required: ["postId"],
      },
      mapArgs: (a) => {
        const body: Record<string, unknown> = {};
        if (a.summary !== undefined) body.summary = a.summary;
        if (a.scheduleDate !== undefined) body.scheduleDate = a.scheduleDate;
        if (a.status !== undefined) body.status = a.status;
        if (Array.isArray(a.mediaUrls)) {
          body.media = (a.mediaUrls as string[]).map((url) => ({ url, type: "image" }));
        }
        return { params: { postId: a.postId }, body };
      },
      sideEffect: "write",
      cost: "cheap",
    },
    {
      name: "ghl_delete_social_post",
      action: "delete_social_post",
      description: "Delete a GHL social post permanently.",
      schema: {
        type: "object",
        properties: { postId: { type: "string" } },
        required: ["postId"],
      },
      mapArgs: (a) => ({ params: { postId: a.postId } }),
      sideEffect: "destructive",
      cost: "free",
    },

    // ============ MEDIA (for Social Planner attachments) ============
    {
      name: "ghl_upload_media",
      action: "upload_media_file",
      description: "Upload a file to the GHL Media Library and return its public URL — use this to attach media to a social post. Pass either sourceUrl (server fetches it) or fileBase64 + fileName.",
      schema: {
        type: "object",
        properties: {
          sourceUrl: { type: "string", description: "Public URL of the file to upload." },
          fileBase64: { type: "string" },
          fileName: { type: "string" },
          mimeType: { type: "string" },
        },
        required: [],
      },
      mapArgs: (a) => ({
        body: {
          sourceUrl: a.sourceUrl,
          fileBase64: a.fileBase64,
          fileName: a.fileName,
          mimeType: a.mimeType,
        },
      }),
      formatter: (data) => formatReceipt(data, "Uploaded media: {url} (id: {fileId})"),
      sideEffect: "write",
      cost: "cheap",
    },

    // ============ CUSTOM FIELDS (full skill family) ============
    // GHL dataType values + friendly aliases the model can use:
    //   text -> TEXT, textarea/large_text -> LARGE_TEXT, number/numerical -> NUMERICAL,
    //   phone -> PHONE, date -> DATE, dropdown/single_select -> SINGLE_OPTIONS,
    //   multi_select/multiple_options -> MULTIPLE_OPTIONS, radio -> RADIO,
    //   checkbox -> CHECKBOX, monetary/money -> MONETORY (GHL spelling).
    {
      name: "ghl_list_custom_fields",
      action: "list_custom_fields",
      description: "List GoHighLevel custom fields. Optionally filter by objectType (contact | opportunity | business). Always run before create/update to detect duplicates.",
      schema: {
        type: "object",
        properties: {
          objectType: { type: "string", description: "contact | opportunity | business" },
        },
        required: [],
      },
      mapArgs: (a) => ({ params: { objectType: a.objectType } }),
      formatter: (data) =>
        formatList(data, "customFields", { title: "name", sub: "dataType", meta: "id" }, { label: "custom fields" }),
      sideEffect: "read",
      cost: "free",
    },
    {
      name: "ghl_get_custom_field",
      action: "get_custom_field",
      description: "Fetch a single GoHighLevel custom field by ID for audit or confirmation.",
      schema: {
        type: "object",
        properties: { customFieldId: { type: "string" } },
        required: ["customFieldId"],
      },
      mapArgs: (a) => ({ params: { customFieldId: a.customFieldId } }),
      sideEffect: "read",
      cost: "free",
    },
    {
      name: "ghl_create_custom_field",
      action: "create_custom_field",
      description: "Create a new GoHighLevel custom field. Specify name, dataType, objectType. For dropdown/multi-select/radio/checkbox provide an `options` array. ALWAYS call ghl_list_custom_fields first to check for duplicates by name and fieldKey — if a match exists, ask the user whether to update the existing field (use ghl_update_custom_field) or create a variant with a different name.",
      schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Display label." },
          dataType: { type: "string", description: "text | textarea | number | phone | date | dropdown | multi_select | radio | checkbox | monetary (also accepts GHL raw values)." },
          objectType: { type: "string", description: "contact | opportunity | business. Defaults to contact." },
          fieldKey: { type: "string", description: "Internal key. Auto-derived from name if omitted." },
          placeholder: { type: "string" },
          defaultValue: { type: "string" },
          position: { type: "number" },
          parentId: { type: "string", description: "Folder ID (custom field group)." },
          options: {
            type: "array",
            description: "Required for dropdown/multi_select/radio/checkbox. Each item: { label, value?, position? }. value auto-derived from label if omitted.",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                value: { type: "string" },
                position: { type: "number" },
              },
            },
          },
        },
        required: ["name", "dataType"],
      },
      mapArgs: (a) => {
        const objectType = normalizeObjectType(a.objectType);
        const dataType = normalizeDataType(a.dataType);
        const fieldKey = (a.fieldKey as string | undefined) || deriveFieldKey(a.name as string);
        const body: Record<string, unknown> = {
          name: a.name,
          dataType,
          fieldKey,
          model: objectType,
        };
        if (a.placeholder !== undefined) body.placeholder = a.placeholder;
        if (a.defaultValue !== undefined) body.defaultValue = a.defaultValue;
        if (a.position !== undefined) body.position = a.position;
        if (a.parentId !== undefined) body.parentId = a.parentId;
        if (Array.isArray(a.options)) body.options = normalizeOptions(a.options as Array<Record<string, unknown>>);
        return { body };
      },
      formatter: (data) => formatReceipt(data, "Created custom field {customField.name} (id: {customField.id}, key: {customField.fieldKey})"),
      sideEffect: "write",
      cost: "cheap",
    },
    {
      name: "ghl_update_custom_field",
      action: "update_custom_field",
      description: "Update an existing GoHighLevel custom field — rename, change placeholder, edit options, change position.",
      schema: {
        type: "object",
        properties: {
          customFieldId: { type: "string" },
          name: { type: "string" },
          placeholder: { type: "string" },
          position: { type: "number" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                value: { type: "string" },
                position: { type: "number" },
              },
            },
          },
        },
        required: ["customFieldId"],
      },
      mapArgs: (a) => {
        const body: Record<string, unknown> = {};
        if (a.name !== undefined) body.name = a.name;
        if (a.placeholder !== undefined) body.placeholder = a.placeholder;
        if (a.position !== undefined) body.position = a.position;
        if (Array.isArray(a.options)) body.options = normalizeOptions(a.options as Array<Record<string, unknown>>);
        return { params: { customFieldId: a.customFieldId }, body };
      },
      formatter: (data) => formatReceipt(data, "Updated custom field (id: {customField.id})"),
      sideEffect: "write",
      cost: "cheap",
    },
    {
      name: "ghl_upsert_custom_field",
      action: "create_custom_field",
      description: "Upsert a GoHighLevel custom field — create if missing, update if found. The model MUST first call ghl_list_custom_fields with the same objectType, look for a name or fieldKey match, then either call ghl_update_custom_field (if found) or this tool (if not). Best DX for repeatable workflows.",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          dataType: { type: "string" },
          objectType: { type: "string" },
          fieldKey: { type: "string" },
          placeholder: { type: "string" },
          defaultValue: { type: "string" },
          position: { type: "number" },
          parentId: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                value: { type: "string" },
                position: { type: "number" },
              },
            },
          },
        },
        required: ["name", "dataType"],
      },
      mapArgs: (a) => {
        const objectType = normalizeObjectType(a.objectType);
        const dataType = normalizeDataType(a.dataType);
        const fieldKey = (a.fieldKey as string | undefined) || deriveFieldKey(a.name as string);
        const body: Record<string, unknown> = {
          name: a.name,
          dataType,
          fieldKey,
          model: objectType,
        };
        if (a.placeholder !== undefined) body.placeholder = a.placeholder;
        if (a.defaultValue !== undefined) body.defaultValue = a.defaultValue;
        if (a.position !== undefined) body.position = a.position;
        if (a.parentId !== undefined) body.parentId = a.parentId;
        if (Array.isArray(a.options)) body.options = normalizeOptions(a.options as Array<Record<string, unknown>>);
        return { body };
      },
      formatter: (data) => formatReceipt(data, "Upserted custom field {customField.name} (id: {customField.id})"),
      sideEffect: "write",
      cost: "cheap",
    },
    {
      name: "ghl_archive_custom_field",
      action: "delete_custom_field",
      description: "Archive (delete) a GoHighLevel custom field. WARNING: GHL only supports hard delete via API — historical data tied to the field may become inaccessible. Always confirm with the user first.",
      schema: {
        type: "object",
        properties: { customFieldId: { type: "string" } },
        required: ["customFieldId"],
      },
      mapArgs: (a) => ({ params: { customFieldId: a.customFieldId } }),
      formatter: () => "Custom field archived (deleted permanently in GoHighLevel).",
      sideEffect: "destructive",
      cost: "free",
      requiresConfirmation: true,
    },
  ],
};

// ---------- Custom field helpers ----------
const DATA_TYPE_ALIASES: Record<string, string> = {
  text: "TEXT",
  string: "TEXT",
  textarea: "LARGE_TEXT",
  large_text: "LARGE_TEXT",
  longtext: "LARGE_TEXT",
  number: "NUMERICAL",
  numerical: "NUMERICAL",
  numeric: "NUMERICAL",
  phone: "PHONE",
  date: "DATE",
  dropdown: "SINGLE_OPTIONS",
  single_select: "SINGLE_OPTIONS",
  single_options: "SINGLE_OPTIONS",
  select: "SINGLE_OPTIONS",
  multi_select: "MULTIPLE_OPTIONS",
  multiselect: "MULTIPLE_OPTIONS",
  multiple_options: "MULTIPLE_OPTIONS",
  radio: "RADIO",
  checkbox: "CHECKBOX",
  monetary: "MONETORY",
  money: "MONETORY",
  monetory: "MONETORY",
  currency: "MONETORY",
};

function normalizeDataType(input: unknown): string {
  if (typeof input !== "string") return "TEXT";
  const trimmed = input.trim();
  if (!trimmed) return "TEXT";
  const upper = trimmed.toUpperCase();
  const knownGhl = new Set([
    "TEXT", "LARGE_TEXT", "NUMERICAL", "PHONE", "DATE",
    "SINGLE_OPTIONS", "MULTIPLE_OPTIONS", "RADIO", "CHECKBOX", "MONETORY",
  ]);
  if (knownGhl.has(upper)) return upper;
  const key = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  return DATA_TYPE_ALIASES[key] ?? "TEXT";
}

function normalizeObjectType(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) return "contact";
  const v = input.trim().toLowerCase();
  if (v === "contacts") return "contact";
  if (v === "opportunities") return "opportunity";
  if (v === "businesses") return "business";
  return v;
}

function deriveFieldKey(name: string): string {
  if (!name || typeof name !== "string") return "field";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_") || "field";
}

function normalizeOptions(opts: Array<unknown>): Array<string> {
  // GHL v1 /locations/{id}/customFields expects options as a plain array of strings.
  // Sending objects ({label,value,position}) causes upstream "v.trim is not a function".
  const out: string[] = [];
  for (const o of opts) {
    let s: unknown;
    if (o && typeof o === "object" && !Array.isArray(o)) {
      const r = o as Record<string, unknown>;
      s = r.label ?? r.name ?? r.value ?? r.text;
    } else {
      s = o;
    }
    if (s == null) continue;
    const str = String(s).trim();
    if (str) out.push(str);
  }
  return out;
}

