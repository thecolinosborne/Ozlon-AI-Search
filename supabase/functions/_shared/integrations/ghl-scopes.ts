// GoHighLevel OAuth scope reference.
//
// Maps every GHL AI tool name to the OAuth scopes that the user's Private
// Integration token must include for the tool to succeed. Source of truth used
// by both:
//   - the chat function (filter the tool list per active sub-account)
//   - the Integrations UI (capability badges + missing-scope hints)
//
// If a tool is NOT listed here, it is treated as scope-free (always available
// when GHL is connected). Be conservative: only list scopes GHL actually
// enforces server-side, so we never hide a working tool.

export type GhlScope = string;

/** Tool name -> required OAuth scopes (ALL must be present). */
export const GHL_TOOL_SCOPES: Record<string, GhlScope[]> = {
  // ---- Contacts ----
  ghl_list_contacts:        ["contacts.readonly"],
  ghl_get_contact:          ["contacts.readonly"],
  ghl_search_contacts:      ["contacts.readonly"],
  ghl_create_contact:       ["contacts.write"],
  ghl_update_contact:       ["contacts.write"],
  ghl_delete_contact:       ["contacts.write"],
  ghl_add_tags:             ["contacts.write"],
  ghl_remove_tags:          ["contacts.write"],
  ghl_add_contact_note:     ["contacts.write"],
  ghl_list_contact_notes:   ["contacts.readonly"],
  ghl_add_contact_task:     ["contacts.write"],
  ghl_list_contact_tasks:   ["contacts.readonly"],

  // ---- Custom fields / values ----
  ghl_list_custom_fields:    ["locations/customFields.readonly"],
  ghl_get_custom_field:      ["locations/customFields.readonly"],
  ghl_create_custom_field:   ["locations/customFields.write"],
  ghl_update_custom_field:   ["locations/customFields.write"],
  ghl_upsert_custom_field:   ["locations/customFields.write"],
  ghl_archive_custom_field:  ["locations/customFields.write"],
  ghl_list_custom_values:    ["locations/customValues.readonly"],

  // ---- Opportunities / pipelines ----
  ghl_list_pipelines:        ["opportunities.readonly"],
  ghl_list_opportunities:    ["opportunities.readonly"],
  ghl_get_opportunity:       ["opportunities.readonly"],
  ghl_create_opportunity:    ["opportunities.write"],
  ghl_update_opportunity:    ["opportunities.write"],

  // ---- Calendars / appointments ----
  ghl_list_calendars:        ["calendars.readonly"],
  ghl_get_calendar_events:   ["calendars/events.readonly"],
  ghl_get_free_slots:        ["calendars.readonly"],
  ghl_create_appointment:    ["calendars/events.write"],
  ghl_book_appointment:      ["calendars/events.write"],
  ghl_update_appointment:    ["calendars/events.write"],
  ghl_cancel_appointment:    ["calendars/events.write"],

  // ---- Conversations / messages ----
  ghl_list_conversations:        ["conversations.readonly"],
  ghl_get_conversation:          ["conversations.readonly"],
  ghl_get_conversation_messages: ["conversations/message.readonly"],
  ghl_send_message:              ["conversations/message.write"],

  // ---- Workflows / campaigns ----
  ghl_list_workflows:        ["workflows.readonly"],
  ghl_trigger_workflow:      ["workflows.readonly"], // GHL uses this scope for trigger too
  ghl_list_campaigns:        ["campaigns.readonly"],

  // ---- Invoices / payments ----
  ghl_list_invoices:         ["invoices.readonly"],
  ghl_get_invoice:           ["invoices.readonly"],
  ghl_create_invoice:        ["invoices.write"],
  ghl_list_orders:           ["payments/orders.readonly"],
  ghl_list_transactions:     ["payments/transactions.readonly"],

  // ---- Forms / surveys ----
  ghl_list_forms:            ["forms.readonly"],
  ghl_get_form_submissions:  ["forms.readonly"],
  ghl_list_surveys:          ["surveys.readonly"],
  ghl_get_survey_submissions:["surveys.readonly"],

  // ---- Funnels ----
  ghl_list_funnels:          ["funnels/redirect.readonly"],

  // ---- Tags / users ----
  ghl_list_tags:             ["locations.readonly"],
  ghl_list_users:            ["users.readonly"],

  // ---- Social Planner ----
  ghl_list_social_accounts:  ["socialplanner/account.readonly"],
  ghl_list_social_posts:     ["socialplanner/post.readonly"],
  ghl_get_social_post:       ["socialplanner/post.readonly"],
  ghl_create_social_post:    ["socialplanner/post.write"],
  ghl_edit_social_post:      ["socialplanner/post.write"],
  ghl_delete_social_post:    ["socialplanner/post.write"],

  // ---- Products ----
  ghl_list_products:         ["products.readonly"],
  ghl_get_product:           ["products.readonly"],
  ghl_create_product:        ["products.write"],
  ghl_update_product:        ["products.write"],
  ghl_delete_product:        ["products.write"],

  // ---- Courses ----
  ghl_list_courses:          ["courses.readonly"],
  ghl_import_courses:        ["courses.write"],

  // ---- Blogs ----
  ghl_list_blog_sites:       ["blogs/post.readonly"],
  ghl_list_blog_posts:       ["blogs/post.readonly"],
  ghl_get_blog_post:         ["blogs/post.readonly"],
  ghl_create_blog_post:      ["blogs/post.write"],
  ghl_update_blog_post:      ["blogs/post.write"],
  ghl_delete_blog_post:      ["blogs/post.write"],

  // ---- Media ----
  ghl_list_media_files:      ["medias.readonly"],
  ghl_upload_media_file:     ["medias.write"],
  ghl_upload_media:          ["medias.write"],

  // ---- Companies / businesses / links ----
  ghl_list_companies:        ["companies.readonly"],
  ghl_get_company:           ["companies.readonly"],
  ghl_list_businesses:       ["businesses.readonly"],
  ghl_get_business:          ["businesses.readonly"],
  ghl_list_links:            ["links.readonly"],
  ghl_create_link:           ["links.write"],
  ghl_update_link:           ["links.write"],
};

/** Capability groups for the UI badge matrix. */
export const GHL_CAPABILITY_GROUPS: Array<{
  key: string;
  label: string;
  scopes: GhlScope[];   // ANY of these means the capability is partially available
  writeScope?: GhlScope; // optional — presence implies full read+write
}> = [
  { key: "contacts",      label: "Contacts",       scopes: ["contacts.readonly", "contacts.write"], writeScope: "contacts.write" },
  { key: "customFields",  label: "Custom Fields",  scopes: ["locations/customFields.readonly", "locations/customFields.write"], writeScope: "locations/customFields.write" },
  { key: "opportunities", label: "Opportunities",  scopes: ["opportunities.readonly", "opportunities.write"], writeScope: "opportunities.write" },
  { key: "calendars",     label: "Calendars",      scopes: ["calendars.readonly", "calendars/events.readonly", "calendars/events.write"], writeScope: "calendars/events.write" },
  { key: "conversations", label: "Conversations",  scopes: ["conversations.readonly", "conversations/message.readonly", "conversations/message.write"], writeScope: "conversations/message.write" },
  { key: "workflows",     label: "Workflows",      scopes: ["workflows.readonly"] },
  { key: "campaigns",     label: "Campaigns",      scopes: ["campaigns.readonly"] },
  { key: "invoices",      label: "Invoices",       scopes: ["invoices.readonly", "invoices.write"], writeScope: "invoices.write" },
  { key: "payments",      label: "Payments",       scopes: ["payments/orders.readonly", "payments/transactions.readonly"] },
  { key: "forms",         label: "Forms",          scopes: ["forms.readonly"] },
  { key: "surveys",       label: "Surveys",        scopes: ["surveys.readonly"] },
  { key: "social",        label: "Social Planner", scopes: ["socialplanner/account.readonly", "socialplanner/post.readonly", "socialplanner/post.write"], writeScope: "socialplanner/post.write" },
  { key: "products",      label: "Products",       scopes: ["products.readonly", "products.write"], writeScope: "products.write" },
  { key: "blogs",         label: "Blogs",          scopes: ["blogs/post.readonly", "blogs/post.write"], writeScope: "blogs/post.write" },
  { key: "media",         label: "Media",          scopes: ["medias.readonly", "medias.write"], writeScope: "medias.write" },
  { key: "businesses",    label: "Businesses",     scopes: ["businesses.readonly"] },
  { key: "companies",     label: "Companies",      scopes: ["companies.readonly"] },
  { key: "links",         label: "Trigger Links",  scopes: ["links.readonly", "links.write"], writeScope: "links.write" },
];

/** Decode a GHL Private Integration JWT and extract granted scopes.
 *  Returns [] on any parse error — scopes will be unknown, NOT empty-by-policy. */
export function decodeGhlScopes(token: string): GhlScope[] {
  if (!token || typeof token !== "string") return [];
  const parts = token.split(".");
  if (parts.length < 2) return [];
  try {
    // base64url -> base64
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json = atob(b64);
    const payload = JSON.parse(json) as Record<string, unknown>;
    // GHL embeds scopes here on PIT JWTs
    const candidates: unknown[] = [
      (payload.oauthMeta as Record<string, unknown> | undefined)?.scopes,
      payload.scopes,
      payload.scope, // sometimes a space-delimited string
    ];
    for (const c of candidates) {
      if (Array.isArray(c)) return c.filter((s): s is string => typeof s === "string");
      if (typeof c === "string" && c.trim()) return c.trim().split(/\s+/);
    }
  } catch (_e) {
    return [];
  }
  return [];
}

/** True if the token is scoped for every scope the tool needs. */
export function hasScopesForTool(toolName: string, grantedScopes: GhlScope[] | null | undefined): boolean {
  const required = GHL_TOOL_SCOPES[toolName];
  if (!required || required.length === 0) return true; // unmapped → permissive
  // If we have NO scope list (legacy sub-account never verified), don't gate —
  // fall back to today's behavior so existing setups keep working.
  if (!grantedScopes || grantedScopes.length === 0) return true;
  const set = new Set(grantedScopes);
  return required.every((s) => set.has(s));
}

/** Filter a list of GHL tool names down to those allowed by the token's scopes. */
export function filterGhlToolsByScopes(toolNames: string[], grantedScopes: GhlScope[] | null | undefined): string[] {
  return toolNames.filter((n) => hasScopesForTool(n, grantedScopes));
}
