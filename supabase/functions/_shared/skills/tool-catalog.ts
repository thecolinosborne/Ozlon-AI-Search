// Curated catalog of Ozlon tools available to skills.
// Used by:
//  - skills-ingest AI normalizer (so the model picks real tool names)
//  - Ozlon scan (to flag unknown tools)
//  - SkillBuilder UI chips (single source of truth)

export type SideEffect = "read" | "write" | "destructive";

export interface CatalogTool {
  name: string;
  description: string;
  side_effect: SideEffect;
  category: string;
}

export const KNOWN_TOOLS: CatalogTool[] = [
  // Email
  { name: "list_emails", description: "List recent emails from a Gmail account", side_effect: "read", category: "email" },
  { name: "search_emails", description: "Search emails by keyword/sender/date", side_effect: "read", category: "email" },
  { name: "read_email", description: "Read a single email by id", side_effect: "read", category: "email" },
  { name: "create_email_draft", description: "Create a draft email (no send)", side_effect: "write", category: "email" },
  { name: "send_email", description: "Send an email immediately", side_effect: "write", category: "email" },
  { name: "label_email", description: "Apply or remove a Gmail label", side_effect: "write", category: "email" },
  { name: "trash_email", description: "Move an email to trash (recoverable)", side_effect: "destructive", category: "email" },
  { name: "archive_email", description: "Archive an email", side_effect: "write", category: "email" },

  // Calendar
  { name: "calendar_list_events", description: "List Google Calendar events in a window", side_effect: "read", category: "calendar" },
  { name: "calendar_find_free_slots", description: "Find free busy slots", side_effect: "read", category: "calendar" },
  { name: "create_calendar_event", description: "Create a calendar event", side_effect: "write", category: "calendar" },
  { name: "update_calendar_event", description: "Update an existing event", side_effect: "write", category: "calendar" },
  { name: "delete_calendar_event", description: "Delete a calendar event", side_effect: "destructive", category: "calendar" },

  // Drive
  { name: "search_google_drive", description: "Search files in Google Drive", side_effect: "read", category: "drive" },
  { name: "read_google_drive_file", description: "Read a Drive file's content", side_effect: "read", category: "drive" },

  // Docs / Sheets / Slides
  { name: "create_google_doc", description: "Create a Google Doc", side_effect: "write", category: "docs" },
  { name: "docs_apply_markdown", description: "Apply markdown to a Doc", side_effect: "write", category: "docs" },
  { name: "create_google_sheet", description: "Create a Sheet", side_effect: "write", category: "sheets" },
  { name: "sheets_append_rows", description: "Append rows to a Sheet", side_effect: "write", category: "sheets" },
  { name: "sheets_read_range", description: "Read a range from a Sheet", side_effect: "read", category: "sheets" },
  { name: "create_google_slides", description: "Create a Slides deck", side_effect: "write", category: "slides" },

  // Slack
  { name: "slack_list_channels", description: "List Slack channels", side_effect: "read", category: "slack" },
  { name: "slack_list_messages", description: "List recent messages in a channel/DM", side_effect: "read", category: "slack" },
  { name: "slack_send_message", description: "Send a Slack message", side_effect: "write", category: "slack" },

  // GoHighLevel
  { name: "ghl_list_contacts", description: "List GHL contacts", side_effect: "read", category: "ghl" },
  { name: "ghl_create_contact", description: "Create a GHL contact", side_effect: "write", category: "ghl" },
  { name: "ghl_update_contact", description: "Update a GHL contact", side_effect: "write", category: "ghl" },
  { name: "ghl_send_message", description: "Send GHL message (SMS/email)", side_effect: "write", category: "ghl" },
  { name: "ghl_create_opportunity", description: "Create a GHL opportunity", side_effect: "write", category: "ghl" },
  { name: "ghl_social_post", description: "Schedule a Social Planner post", side_effect: "write", category: "ghl" },

  // ClickUp
  { name: "clickup_list_tasks", description: "List ClickUp tasks", side_effect: "read", category: "clickup" },
  { name: "clickup_create_task", description: "Create a ClickUp task", side_effect: "write", category: "clickup" },
  { name: "clickup_update_task", description: "Update a ClickUp task", side_effect: "write", category: "clickup" },

  // Research / web
  { name: "research_web", description: "Search the web (Tavily) and synthesize", side_effect: "read", category: "research" },
  { name: "web_search_google", description: "Direct Google web search", side_effect: "read", category: "research" },
  { name: "scrape_url", description: "Scrape page content (Firecrawl)", side_effect: "read", category: "research" },

  // Analytics
  { name: "ga_query", description: "Query Google Analytics 4", side_effect: "read", category: "analytics" },
  { name: "gsc_query", description: "Query Google Search Console", side_effect: "read", category: "analytics" },

  // Finance
  { name: "list_transactions", description: "List Plaid transactions", side_effect: "read", category: "finance" },
  { name: "list_accounts", description: "List Plaid accounts", side_effect: "read", category: "finance" },

  // Memory / wisdom
  { name: "search_wisdom_memories", description: "Semantic search over wisdom_memories", side_effect: "read", category: "memory" },
  { name: "search_knowledge", description: "Semantic search over knowledge_entries", side_effect: "read", category: "memory" },
  { name: "save_memory", description: "Persist a new wisdom_memory", side_effect: "write", category: "memory" },
  { name: "load_skill", description: "Activate an installed skill by slug (used by orchestrator skills to hand off)", side_effect: "read", category: "memory" },

  // Image / video
  { name: "generate_image", description: "Generate an image", side_effect: "write", category: "media" },
  { name: "generate_video", description: "Generate a short video", side_effect: "write", category: "media" },
];

export const TOOL_NAMES = new Set(KNOWN_TOOLS.map((t) => t.name));

export function getTool(name: string): CatalogTool | undefined {
  return KNOWN_TOOLS.find((t) => t.name === name);
}

/** Compact catalog string fed into the AI normalizer prompt. */
export function catalogForPrompt(): string {
  return KNOWN_TOOLS.map((t) => `- ${t.name} (${t.side_effect}): ${t.description}`).join("\n");
}
