// Slack integration manifest — uses Lovable connector gateway (no API key in code).
// Bot token scope: full workspace control (send/read messages, channels, users, search).

import type { IntegrationManifest } from "./types.ts";

export const slackIntegration: IntegrationManifest = {
  id: "slack",
  displayName: "Slack",
  edgeFunction: "slack",
  envelope: "nested",
  tools: [
    {
      name: "slack_send_message",
      description: "Post a message to a Slack channel, DM, or thread. Use channel ID (C…/D…/G…) or '#channel-name'.",
      action: "send_message",
      schema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel ID or #name" },
          text: { type: "string", description: "Message text (supports Slack mrkdwn)" },
          thread_ts: { type: "string", description: "Optional parent message ts to reply in thread" },
          blocks: { type: "array", description: "Optional Slack Block Kit blocks", items: { type: "object" } },
        },
        required: ["channel", "text"],
      },
    },
    {
      name: "slack_list_channels",
      description: "List channels in the workspace (public, private, DMs, group DMs).",
      action: "list_channels",
      schema: {
        type: "object",
        properties: {
          types: { type: "string", description: "Comma-separated: public_channel,private_channel,mpim,im", default: "public_channel" },
          limit: { type: "number", default: 100 },
          cursor: { type: "string", description: "Pagination cursor" },
        },
      },
    },
    {
      name: "slack_get_channel_history",
      description: "Fetch recent messages from a channel.",
      action: "get_channel_history",
      schema: {
        type: "object",
        properties: {
          channel: { type: "string" },
          limit: { type: "number", default: 50 },
          oldest: { type: "string", description: "Unix ts" },
          latest: { type: "string", description: "Unix ts" },
        },
        required: ["channel"],
      },
    },
    {
      name: "slack_search_messages",
      description: "Search messages across the workspace using Slack's search syntax.",
      action: "search_messages",
      schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Slack search query (e.g. 'in:#general from:@alice deploy')" },
          count: { type: "number", default: 20 },
          sort: { type: "string", enum: ["score", "timestamp"], default: "timestamp" },
        },
        required: ["query"],
      },
    },
    {
      name: "slack_list_users",
      description: "List workspace members.",
      action: "list_users",
      schema: {
        type: "object",
        properties: {
          limit: { type: "number", default: 100 },
          cursor: { type: "string" },
        },
      },
    },
    {
      name: "slack_lookup_user_by_email",
      description: "Find a Slack user by email address. Returns the user object including ID.",
      action: "lookup_user_by_email",
      schema: {
        type: "object",
        properties: { email: { type: "string" } },
        required: ["email"],
      },
    },
    {
      name: "slack_create_channel",
      description: "Create a new public or private channel.",
      action: "create_channel",
      schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Channel name (lowercase, no spaces)" },
          is_private: { type: "boolean", default: false },
        },
        required: ["name"],
      },
    },
    {
      name: "slack_add_reaction",
      description: "Add an emoji reaction to a message.",
      action: "add_reaction",
      schema: {
        type: "object",
        properties: {
          channel: { type: "string" },
          timestamp: { type: "string", description: "Message ts" },
          name: { type: "string", description: "Emoji name without colons (e.g. 'thumbsup')" },
        },
        required: ["channel", "timestamp", "name"],
      },
    },
  ],
};
