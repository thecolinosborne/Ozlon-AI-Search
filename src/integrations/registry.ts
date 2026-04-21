/**
 * Frontend integration registry — single source of truth for hub list + auto-rendered detail pages.
 *
 * Adding a new integration:
 *   1. Add a manifest entry below.
 *   2. (If non-Google) ensure the edge function exists.
 *   3. Done — it appears in /integrations and gets a working detail page at
 *      /integrations/<id> via the catch-all <AutoIntegrationDetail /> route.
 *
 * Custom *Detail.tsx pages still take precedence (they're declared explicitly
 * in App.tsx before the catch-all). Only fall back to one when the integration
 * needs UI that the auto-renderer can't express (e.g. ClickUp's webhook config,
 * GHL's location picker, Plaid Link).
 */
import {
  Globe, Video, CheckSquare, Youtube, Mail, HardDrive, Calendar,
  FileSpreadsheet, FileText, Presentation, BarChart3, Search, Tag,
  type LucideIcon,
} from "lucide-react";

export type IntegrationCategory = "google" | "crm" | "media" | "productivity" | "seo";

export interface IntegrationManifest {
  /** URL slug + integrations-store id. */
  id: string;
  /** Display name. */
  name: string;
  /** One-liner shown on the hub card and the detail header. */
  description: string;
  /** Lucide icon. */
  icon: LucideIcon;
  /** Category filter bucket. */
  category: IntegrationCategory;
  /**
   * Provider key in `integration_connections.provider`. Multiple integrations
   * can share one provider row (all Google services share `youtube`).
   */
  provider: string;
  /**
   * Edge function the auto-renderer calls for `testAction`. Omit if this
   * integration has no test endpoint or uses a custom detail page.
   */
  fnName?: string;
  /** Action passed to fnName for the "Test connection" button. */
  testAction?: string;
  /** Friendly label for the test button (defaults to the integration name). */
  testLabel?: string;
  /**
   * Auth pattern the auto-renderer should render. "google-oauth" reuses the
   * shared Workspace OAuth + scope gating; "api-key" expects a credential
   * already set via the dedicated detail page (the auto page just shows status);
   * "none" hides the auth section entirely.
   */
  auth: "google-oauth" | "api-key" | "none";
  /**
   * If true, this integration is rendered by a custom *Detail.tsx page (declared
   * explicitly in App.tsx). The catch-all auto-renderer is skipped for this id.
   */
  customDetailPage?: boolean;
}

export const INTEGRATIONS: IntegrationManifest[] = [
  // CRM / productivity / media — custom detail pages (auth flows are bespoke)
  {
    id: "gohighlevel",
    name: "Go High Level",
    description: "CRM with contacts, pipelines, conversations, and marketing tools.",
    icon: Globe,
    category: "crm",
    provider: "gohighlevel",
    auth: "api-key",
    customDetailPage: true,
  },
  {
    id: "descript",
    name: "Descript",
    description: "Video and podcast editing platform. Sync media and content assets.",
    icon: Video,
    category: "media",
    provider: "descript",
    fnName: "descript",
    testAction: "list_projects",
    testLabel: "Projects",
    auth: "api-key",
    customDetailPage: true,
  },
  {
    id: "clickup",
    name: "ClickUp",
    description: "Task management with AI-powered project manager replies inside task comments.",
    icon: CheckSquare,
    category: "productivity",
    provider: "clickup",
    auth: "api-key",
    customDetailPage: true,
  },

  // Google Apps — share one OAuth row; each gets its own card + detail page
  {
    id: "youtube",
    name: "YouTube",
    description: "Channel data, video uploads, and the YouTube Data API.",
    icon: Youtube,
    category: "google",
    provider: "youtube",
    fnName: "youtube",
    testAction: "list_channels",
    testLabel: "Channel",
    auth: "google-oauth",
    customDetailPage: true, // still has bespoke OAuth bootstrap UI
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Read, search, send, and manage email.",
    icon: Mail,
    category: "google",
    provider: "youtube",
    fnName: "google-gmail",
    testAction: "get_profile",
    testLabel: "Gmail Profile",
    auth: "google-oauth",
    customDetailPage: true,
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Browse, upload, and manage Drive files.",
    icon: HardDrive,
    category: "google",
    provider: "youtube",
    fnName: "google-drive",
    testAction: "get_storage_quota",
    testLabel: "Storage Quota",
    auth: "google-oauth",
    customDetailPage: true,
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "View, create, and manage calendar events.",
    icon: Calendar,
    category: "google",
    provider: "youtube",
    fnName: "google-calendar",
    testAction: "list_calendars",
    testLabel: "Calendars",
    auth: "google-oauth",
    customDetailPage: true,
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Read and write spreadsheet data.",
    icon: FileSpreadsheet,
    category: "google",
    provider: "youtube",
    fnName: "google-sheets",
    testAction: "list_spreadsheets",
    testLabel: "Spreadsheets",
    auth: "google-oauth",
    customDetailPage: true,
  },
  {
    id: "google-docs",
    name: "Google Docs",
    description: "Create and edit Google Documents.",
    icon: FileText,
    category: "google",
    provider: "youtube",
    fnName: "google-docs",
    testAction: "list_documents",
    testLabel: "Documents",
    auth: "google-oauth",
    customDetailPage: true,
  },
  {
    id: "google-slides",
    name: "Google Slides",
    description: "Create and edit Google Slides presentations.",
    icon: Presentation,
    category: "google",
    provider: "youtube",
    fnName: "google-slides",
    testAction: "list_presentations",
    testLabel: "Presentations",
    auth: "google-oauth",
    customDetailPage: true,
  },
  {
    id: "google-analytics",
    name: "Google Analytics",
    description: "Query GA4 properties for traffic and conversion data.",
    icon: BarChart3,
    category: "google",
    provider: "youtube",
    fnName: "google-analytics",
    testAction: "list_accounts",
    testLabel: "GA4 Accounts",
    auth: "google-oauth",
    customDetailPage: true,
  },
  {
    id: "google-search-console",
    name: "Search Console",
    description: "Pull SEO performance data for verified properties.",
    icon: Search,
    category: "google",
    provider: "youtube",
    fnName: "google-search-console",
    testAction: "list_sites",
    testLabel: "Verified Sites",
    auth: "google-oauth",
    customDetailPage: true,
  },
  {
    id: "google-tag-manager",
    name: "Tag Manager",
    description: "Manage GTM containers, tags, and triggers.",
    icon: Tag,
    category: "google",
    provider: "youtube",
    fnName: "google-tag-manager",
    testAction: "list_accounts",
    testLabel: "GTM Accounts",
    auth: "google-oauth",
    customDetailPage: true,
  },
  {
    id: "search-atlas",
    name: "Search Atlas",
    description: "Site audit, keyword research, backlinks, and rank tracking.",
    icon: Search,
    category: "seo",
    provider: "search_atlas",
    fnName: "search-atlas",
    testAction: "list_projects",
    testLabel: "Projects",
    auth: "api-key",
    customDetailPage: true,
  },
];

/** Map: integration id → manifest. */
export const INTEGRATIONS_BY_ID: Map<string, IntegrationManifest> = new Map(
  INTEGRATIONS.map((i) => [i.id, i]),
);

/** Map: integration id → provider key (used to read integration_connections rows). */
export const PROVIDER_BY_ID: Record<string, string> = Object.fromEntries(
  INTEGRATIONS.map((i) => [i.id, i.provider]),
);

export function getIntegrationManifest(id: string): IntegrationManifest | undefined {
  return INTEGRATIONS_BY_ID.get(id);
}
