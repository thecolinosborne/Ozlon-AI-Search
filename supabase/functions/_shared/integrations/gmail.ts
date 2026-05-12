// Gmail Tier 1 tools — pure pass-through to google-gmail edge function.
// (Base tools — send_email, list_emails, get_email, trash_email, label_email,
// mark_email_read, batch_trash_emails, list_email_ids — stay on the legacy
// switch in chat/index.ts because they need multi-account alias resolution.)
import type { IntegrationManifest } from "./types.ts";

export const gmailIntegration: IntegrationManifest = {
  id: "gmail",
  displayName: "Gmail",
  edgeFunction: "google-gmail",
  envelope: "nested",
  tools: [
    {
      name: "gmail_list_filters",
      description: "List all Gmail filters (auto-rules that label, archive, forward, or delete incoming mail). Read-only.",
      action: "list_filters",
      schema: { type: "object", properties: {} },
    },
    {
      name: "gmail_create_filter",
      description: "Create a Gmail filter. Provide BOTH `criteria` (what mail to match) AND `action` (what to do) as nested objects. To auto-trash: set action.addLabelIds=['TRASH']. To label+archive: set action.addLabelIds=['<labelId>'] and action.removeLabelIds=['INBOX']. Always confirm destructive filters (TRASH, SPAM) with user first.",
      action: "create_filter",
      sideEffect: "write",
      cost: "cheap",
      requiresConfirmation: true,
      schema: {
        type: "object",
        properties: {
          criteria: {
            type: "object",
            description: "Match rules. At least one field required.",
            properties: {
              from: { type: "string", description: "Sender email or domain" },
              to: { type: "string", description: "Recipient email" },
              subject: { type: "string", description: "Subject substring" },
              query: { type: "string", description: "Raw Gmail search query (e.g. 'has:attachment older_than:1y')" },
              hasAttachment: { type: "boolean" },
              excludeChats: { type: "boolean" },
              size: { type: "number" },
            },
          },
          action: {
            type: "object",
            description: "What to do with matching mail.",
            properties: {
              addLabelIds: { type: "array", items: { type: "string" }, description: "Label IDs to add. Use 'TRASH' to auto-delete, 'SPAM' to mark spam, or a custom label ID." },
              removeLabelIds: { type: "array", items: { type: "string" }, description: "Label IDs to remove. Use 'INBOX' to auto-archive, 'UNREAD' to auto-mark-read." },
              forward: { type: "string", description: "Forward to this email address (must be a verified forwarding address)." },
            },
          },
        },
        required: ["criteria", "action"],
      },
      mapArgs: (args) => {
        // If model already nested correctly, pass through.
        const hasNestedCriteria = args.criteria && typeof args.criteria === "object";
        const hasNestedAction = args.action && typeof args.action === "object";
        if (hasNestedCriteria && hasNestedAction) return args;

        // Defensive: re-nest flat args the model may have produced.
        const a = args as Record<string, unknown>;
        const criteria: Record<string, unknown> = (hasNestedCriteria ? a.criteria : {}) as Record<string, unknown>;
        const action: Record<string, unknown> = (hasNestedAction ? a.action : {}) as Record<string, unknown>;

        for (const k of ["from", "to", "subject", "query", "hasAttachment", "excludeChats", "size"]) {
          if (a[k] !== undefined && criteria[k] === undefined) criteria[k] = a[k];
        }
        for (const k of ["addLabelIds", "removeLabelIds", "forward"]) {
          if (a[k] !== undefined && action[k] === undefined) action[k] = a[k];
        }
        // Common shorthand: { trash: true } → addLabelIds: ['TRASH']
        if (a.trash === true && !action.addLabelIds) action.addLabelIds = ["TRASH"];
        if (a.archive === true) {
          const remove = (action.removeLabelIds as string[] | undefined) ?? [];
          if (!remove.includes("INBOX")) action.removeLabelIds = [...remove, "INBOX"];
        }
        if (a.markRead === true) {
          const remove = (action.removeLabelIds as string[] | undefined) ?? [];
          if (!remove.includes("UNREAD")) action.removeLabelIds = [...remove, "UNREAD"];
        }

        return { criteria, action };
      },
    },
    {
      name: "gmail_delete_filter",
      description: "Delete a Gmail filter by its filter ID. Confirm with user first.",
      action: "delete_filter",
      schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    {
      name: "gmail_get_filter",
      description: "Get details of a single Gmail filter by ID.",
      action: "get_filter",
      schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    {
      name: "gmail_get_vacation",
      description: "Get the user current Gmail vacation auto-responder settings.",
      action: "get_vacation",
      schema: { type: "object", properties: {} },
    },
    {
      name: "gmail_update_vacation",
      description: "Enable or update the Gmail vacation auto-responder. Set enableAutoReply false to disable.",
      action: "update_vacation",
      schema: {
        type: "object",
        properties: {
          enableAutoReply: { type: "boolean" },
          responseSubject: { type: "string" },
          responseBodyPlainText: { type: "string" },
          restrictToContacts: { type: "boolean" },
          restrictToDomain: { type: "boolean" },
          startTime: { type: "number", description: "Unix epoch ms (optional)" },
          endTime: { type: "number", description: "Unix epoch ms (optional)" },
        },
        required: ["enableAutoReply"],
      },
    },
    {
      name: "gmail_list_send_as",
      description: "List the user Gmail send-as addresses (primary + aliases) and their current signatures.",
      action: "list_send_as",
      schema: { type: "object", properties: {} },
    },
    {
      name: "gmail_update_signature",
      description: "Update the HTML signature for a specific Gmail send-as address.",
      action: "update_signature",
      schema: {
        type: "object",
        properties: {
          sendAsEmail: { type: "string", description: "The send-as address (e.g. user@example.com)" },
          signature: { type: "string", description: "HTML signature content" },
        },
        required: ["sendAsEmail", "signature"],
      },
    },
    {
      name: "gmail_forward_message",
      description: "Forward an email to a recipient. Provide the original message ID for threading context.",
      action: "forward_message",
      schema: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          originalMessageId: { type: "string" },
        },
        required: ["to"],
      },
    },
    {
      name: "gmail_send_with_attachment",
      description: "Send an email with one or more attachments. Each attachment must include filename, mimeType, and base64-encoded data.",
      action: "send_with_attachment",
      schema: {
        type: "object",
        properties: {
          to: { type: "string" },
          subject: { type: "string" },
          body: { type: "string" },
          cc: { type: "string" },
          bcc: { type: "string" },
          attachments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                filename: { type: "string" },
                mimeType: { type: "string" },
                dataBase64: { type: "string" },
              },
              required: ["filename", "mimeType", "dataBase64"],
            },
          },
        },
        required: ["to", "subject", "attachments"],
      },
    },
    {
      name: "gmail_list_attachments",
      description: "List downloadable attachments on a single Gmail message. Returns attachmentId, filename, mimeType, sizeBytes for each.",
      action: "list_attachments",
      schema: {
        type: "object",
        properties: { messageId: { type: "string" } },
        required: ["messageId"],
      },
    },
    {
      name: "gmail_list_thread_attachments",
      description: "List downloadable attachments across EVERY message in a Gmail thread. Use this when the user references a file in an email but you don't yet know which specific message in the thread carries the attachment (e.g. 'the PDF in Ben's email').",
      action: "list_thread_attachments",
      schema: {
        type: "object",
        properties: { threadId: { type: "string" } },
        required: ["threadId"],
      },
    },
    {
      name: "gmail_get_attachment",
      description: "Download a Gmail attachment by message ID + attachment ID. Returns base64 data. For analysis/summarization, prefer gmail_analyze_attachment.",
      action: "get_attachment",
      schema: {
        type: "object",
        properties: {
          messageId: { type: "string" },
          attachmentId: { type: "string" },
        },
        required: ["messageId", "attachmentId"],
      },
    },
    {
      name: "gmail_analyze_attachment",
      description: "Download AND analyze a Gmail attachment. Extracts text from PDFs, DOCX, XLSX, PPTX, plain text/CSV/JSON, and uses vision for images. Pass the messageId, plus EITHER attachmentId OR a filename hint. Optionally pass a `question` to get a targeted answer; otherwise returns a structured summary. Use this whenever the user asks to read, summarize, or ask questions about a file in their inbox.",
      action: "analyze_attachment",
      schema: {
        type: "object",
        properties: {
          messageId: { type: "string", description: "The Gmail message ID containing the attachment." },
          attachmentId: { type: "string", description: "Optional. The specific attachment ID. If omitted, uses filename hint or first attachment." },
          filename: { type: "string", description: "Optional. Substring of the filename to locate the attachment (e.g. 'invoice')." },
          question: { type: "string", description: "Optional. A specific question to answer about the document. If omitted, returns a structured summary." },
        },
        required: ["messageId"],
      },
    },
    {
      name: "gmail_search_attachments_archive",
      description: "Semantic search across all auto-ingested email attachments (the user's long-term document memory). Use when the user asks about a previously received document without specifying which email (e.g. 'what did that contract say', 'find the invoice from last month'). Returns matching attachments with summary, sender, subject, and excerpt.",
      action: "search_attachments_archive",
      schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language description of what to find." },
          limit: { type: "number", description: "Max results (default 5)." },
        },
        required: ["query"],
      },
    },
    {
      name: "gmail_enable_auto_ingest",
      description: "Enable background auto-ingestion of email attachments for an account. Once enabled, the system polls every 15 minutes, parses incoming PDFs/DOCX/XLSX/images, and stores them in the user's searchable archive.",
      action: "enable_auto_ingest",
      schema: {
        type: "object",
        properties: {
          accountEmail: { type: "string", description: "The Gmail address to monitor (e.g. user@gmail.com)." },
          enabled: { type: "boolean", description: "true to enable, false to pause. Defaults to true." },
        },
        required: ["accountEmail"],
      },
    },
    {
      name: "gmail_star_message",
      description: "Star an email (adds STARRED label).",
      action: "star_message",
      schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    {
      name: "gmail_unstar_message",
      description: "Remove the star from an email (removes STARRED label).",
      action: "unstar_message",
      schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    {
      name: "gmail_mark_unread",
      description: "Mark an email as unread (adds UNREAD label).",
      action: "mark_unread",
      schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    {
      name: "gmail_mark_important",
      description: "Mark an email as important (adds IMPORTANT label).",
      action: "mark_important",
      schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    {
      name: "gmail_archive_message",
      description: "Archive an email by removing it from the inbox (does NOT delete it). Per gmail-deletion-policy: never hard-deletes.",
      action: "archive_message",
      schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
    {
      name: "gmail_create_label",
      description: "Create a new Gmail label by name.",
      action: "create_label",
      schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
    {
      name: "gmail_delete_label",
      description: "Delete a Gmail label by ID. Confirm with user first.",
      action: "delete_label",
      schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
  ],
};
