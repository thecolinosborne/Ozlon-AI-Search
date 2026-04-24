// Single source of truth for per-Google-service scope gating + Cloud setup metadata.
// Google returns granted scopes in tokenData.scope (persisted as metadata.scope on
// the shared provider="youtube" integration_connections row). We do simple substring
// matching on the unique short suffix of each scope URL.

export interface GoogleServiceScopeConfig {
  requiredScopes: string[]; // any one match = granted
  apiName: string;
  cloudConsoleUrl: string;
  scopeSummary: string;
}

export const GOOGLE_SERVICE_SCOPES: Record<string, GoogleServiceScopeConfig> = {
  youtube: {
    requiredScopes: ["youtube.upload", "youtube.readonly", "youtube.force-ssl"],
    apiName: "YouTube Data API v3",
    cloudConsoleUrl: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
    scopeSummary: "Upload videos, read channel data and analytics",
  },
  gmail: {
    requiredScopes: ["gmail.readonly", "gmail.send", "gmail.modify", "gmail.compose", "gmail.labels", "gmail.settings.basic"],
    apiName: "Gmail API",
    cloudConsoleUrl: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
    scopeSummary: "Read, send, modify, compose, manage labels, filters, signature, and vacation responder",
  },
  "google-drive": {
    requiredScopes: ["drive.readonly", "drive.file", "auth/drive"],
    apiName: "Google Drive API",
    cloudConsoleUrl: "https://console.cloud.google.com/apis/library/drive.googleapis.com",
    scopeSummary: "List, upload, and read Drive files",
  },
  "google-calendar": {
    requiredScopes: ["calendar.events", "auth/calendar"],
    apiName: "Google Calendar API",
    cloudConsoleUrl: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com",
    scopeSummary: "View and manage calendar events",
  },
  "google-sheets": {
    requiredScopes: ["spreadsheets"],
    apiName: "Google Sheets API",
    cloudConsoleUrl: "https://console.cloud.google.com/apis/library/sheets.googleapis.com",
    scopeSummary: "Read and write spreadsheet data",
  },
  "google-docs": {
    requiredScopes: ["documents"],
    apiName: "Google Docs API",
    cloudConsoleUrl: "https://console.cloud.google.com/apis/library/docs.googleapis.com",
    scopeSummary: "Create and edit Google Documents",
  },
  "google-slides": {
    requiredScopes: ["presentations"],
    apiName: "Google Slides API",
    cloudConsoleUrl: "https://console.cloud.google.com/apis/library/slides.googleapis.com",
    scopeSummary: "Create and edit Google Slides presentations",
  },
  "google-analytics": {
    requiredScopes: ["analytics.readonly"],
    apiName: "Google Analytics Data API (GA4)",
    cloudConsoleUrl: "https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com",
    scopeSummary: "Query GA4 reports for traffic and conversions",
  },
  "google-search-console": {
    requiredScopes: ["webmasters.readonly", "webmasters"],
    apiName: "Google Search Console API",
    cloudConsoleUrl: "https://console.cloud.google.com/apis/library/searchconsole.googleapis.com",
    scopeSummary: "Read SEO performance data for verified sites",
  },
  "google-tag-manager": {
    requiredScopes: ["tagmanager.readonly", "tagmanager.edit.containers", "tagmanager.publish"],
    apiName: "Google Tag Manager API",
    cloudConsoleUrl: "https://console.cloud.google.com/apis/library/tagmanager.googleapis.com",
    scopeSummary: "Read and edit GTM containers, tags, and triggers",
  },
};

export function isServiceGranted(
  serviceId: string,
  grantedScopeString: string | null | undefined,
): boolean {
  const cfg = GOOGLE_SERVICE_SCOPES[serviceId];
  if (!cfg || !grantedScopeString) return false;
  return cfg.requiredScopes.some((s) => grantedScopeString.includes(s));
}

export function getGoogleServiceConfig(serviceId: string): GoogleServiceScopeConfig | undefined {
  return GOOGLE_SERVICE_SCOPES[serviceId];
}
