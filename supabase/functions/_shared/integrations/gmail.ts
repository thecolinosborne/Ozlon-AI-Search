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
      description: "Create a Gmail filter. Confirm with user before creating destructive filters (auto-trash, auto-spam). criteria fields: from, to, subject, query, hasAttachment. action fields: addLabelIds (array), removeLabelIds (array), forward (email).",
      action: "create_filter",
      schema: {
        type: "object",
        properties: {
          criteria: { type: "object", description: 'e.g. { "from": "noreply@stripe.com" } or { "subject": "Invoice" }' },
          action: { type: "object", description: 'e.g. { "addLabelIds": ["Label_123"], "removeLabelIds": ["INBOX"] }' },
        },
        required: ["criteria", "action"],
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
      name: "gmail_get_attachment",
      description: "Download a Gmail attachment by message ID + attachment ID. Returns base64 data.",
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
