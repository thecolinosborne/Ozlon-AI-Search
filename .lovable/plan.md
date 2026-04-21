

## Per-Service Google Status + Setup Guide (One Cloud Project, Many Services)

Right now all 9 sister Google cards (Gmail, Drive, Calendar, Sheets, Docs, Slides, Analytics, Search Console, Tag Manager) light up "Connected" the moment YouTube OAuth completes — because the Integrations page reads a single `provider="youtube"` row and treats any green status as green for everyone. That's wrong: a card should only show "Connected" if the user actually granted that service's scope. We'll also add a clear, per-service Google Cloud setup guide so users know what API to enable and what they're authorizing.

### Architecture

The shared OAuth row stays as-is (one row, all tokens). What changes is **how status is derived** and **what each service page tells the user about setup**.

```text
integration_connections (provider="youtube")
  metadata.scope = "https://...youtube.upload https://...gmail.readonly ..."
                                  │
                  ┌───────────────┴────────────────┐
                  ▼                                ▼
         Integrations page              Per-service detail page
         (parses scope string,          (shows green only if
         lights up only granted         this service's scope is
         service cards)                 in metadata.scope)
```

### Changes

**1. New: `src/lib/googleScopes.ts`** — single source of truth

Map each service id to the OAuth scope(s) that signal it's actually granted, plus its Google Cloud setup metadata:

```ts
export const GOOGLE_SERVICE_SCOPES: Record<string, {
  requiredScopes: string[];      // any one match = granted
  apiName: string;                // shown in setup guide
  cloudConsoleUrl: string;        // direct link to enable the API
  scopeSummary: string;           // human description for setup card
}> = {
  youtube:                { requiredScopes: ["youtube.upload","youtube.readonly"], apiName: "YouTube Data API v3", cloudConsoleUrl: "https://console.cloud.google.com/apis/library/youtube.googleapis.com", scopeSummary: "Upload videos, read channel + analytics" },
  gmail:                  { requiredScopes: ["gmail.readonly","gmail.send","gmail.modify"], apiName: "Gmail API", cloudConsoleUrl: "https://console.cloud.google.com/apis/library/gmail.googleapis.com", scopeSummary: "Read, send, and trash messages" },
  "google-drive":         { requiredScopes: ["drive.readonly","drive.file"], apiName: "Google Drive API", cloudConsoleUrl: "https://console.cloud.google.com/apis/library/drive.googleapis.com", scopeSummary: "List files, upload, read content" },
  "google-calendar":      { requiredScopes: ["calendar","calendar.events"], apiName: "Google Calendar API", cloudConsoleUrl: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com", scopeSummary: "Create and manage events" },
  "google-sheets":        { requiredScopes: ["spreadsheets"], apiName: "Google Sheets API", cloudConsoleUrl: "https://console.cloud.google.com/apis/library/sheets.googleapis.com", scopeSummary: "Read/write spreadsheet ranges" },
  "google-docs":          { requiredScopes: ["documents"], apiName: "Google Docs API", cloudConsoleUrl: "https://console.cloud.google.com/apis/library/docs.googleapis.com", scopeSummary: "Create and edit documents" },
  "google-slides":        { requiredScopes: ["presentations"], apiName: "Google Slides API", cloudConsoleUrl: "https://console.cloud.google.com/apis/library/slides.googleapis.com", scopeSummary: "Create and edit presentations" },
  "google-analytics":     { requiredScopes: ["analytics.readonly"], apiName: "Analytics Data API (GA4)", cloudConsoleUrl: "https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com", scopeSummary: "Query GA4 reports" },
  "google-search-console":{ requiredScopes: ["webmasters.readonly"], apiName: "Search Console API", cloudConsoleUrl: "https://console.cloud.google.com/apis/library/searchconsole.googleapis.com", scopeSummary: "Read SEO performance data" },
  "google-tag-manager":   { requiredScopes: ["tagmanager.readonly","tagmanager.edit.containers","tagmanager.publish"], apiName: "Tag Manager API", cloudConsoleUrl: "https://console.cloud.google.com/apis/library/tagmanager.googleapis.com", scopeSummary: "Read and edit GTM containers" },
};

export function isServiceGranted(serviceId: string, grantedScopeString: string | null | undefined): boolean {
  const cfg = GOOGLE_SERVICE_SCOPES[serviceId];
  if (!cfg || !grantedScopeString) return false;
  return cfg.requiredScopes.some(s => grantedScopeString.includes(s));
}
```

**2. `src/pages/Integrations.tsx` — derive per-service status from scope**

In the hydrate effect, when the `youtube` provider row is found, fetch its `metadata->>scope` (extend the select). For each Google card, set status to `connected` only when `isServiceGranted(id, scope)` is true. The `youtube` card itself uses the same check (won't false-positive). Non-Google integrations (gohighlevel, descript, clickup) keep current behavior.

**3. `src/components/integrations/GoogleServiceDetail.tsx` — per-service truth + setup card**

- Read the granted `scope` from the existing `get_connection` response (already returns `oauthStatus`; we'll also surface `grantedScopes` from `metadata.scope` — small additive field in the YouTube edge function `get_connection` action).
- "Authorized" badge becomes green ONLY when `isServiceGranted(config.serviceId, grantedScopes)` is true. If OAuth row exists but this scope isn't granted, show amber "Authorized at the account level — re-authorize to grant <ServiceName>".
- Replace the "Re-authorize" button copy with **"Authorize <ServiceName>"** (still hits the shared OAuth flow — Google's consent screen will list the same scope set; this messaging just makes it accurate).
- New **Setup card** above the OAuth card: shows `apiName`, `scopeSummary`, and a primary link to `cloudConsoleUrl` ("Enable <API name> in Google Cloud") plus a one-line note that the same OAuth client (`YOUTUBE_CLIENT_ID`) authorizes all Google services. This gives users a clear path before they hit "Authorize".

**4. `src/pages/integrations/YouTubeDetail.tsx` — same treatment**

Add the same Setup card at the top (YouTube Data API v3 + console link), and gate its "Connected" pill on `isServiceGranted("youtube", scope)` — so YouTube alone (not Drive/Gmail/etc.) drives the YouTube card's status. The existing API key + Channel ID inputs remain unchanged and continue to work via the fix that just shipped.

**5. `supabase/functions/youtube/index.ts` — `get_connection` returns `grantedScopes`**

Tiny additive change to the response payload (no schema change): include `grantedScopes: meta.scope ?? null` alongside `oauthStatus`. Frontend uses it for the per-service gating above. No other backend logic changes — token refresh, validation, sync runs all stay identical.

### What you'll see

- **Integrations page**: After authorizing OAuth, only the cards whose scopes Google actually returned in the consent (`metadata.scope`) light up green. Cards for unauthorized scopes stay grey with "Not authorized".
- **Each Google service detail page**: At the top, a Setup card explains exactly what API to enable in Google Cloud + a direct console link. Below that, the OAuth status reflects only that service's scope. The Authorize button takes you through the same shared consent — but the page only goes green when *this* service's scope comes back.
- **YouTube page**: same Setup card pattern. API key + Channel ID still saveable and updatable.

### Out of scope

- No new OAuth client, no per-service incremental consent, no scope splitting (Google requires re-consent to add scopes — that's already what "Authorize" does).
- No DB migration. No new tables. No changes to sync logic, edge function tool calls, or the shared `_shared/google-token.ts` helper.
- No changes to non-Google integrations (GHL, Descript, ClickUp).
- The `PROVIDER_BY_ID` map stays — all Google services still read from the single `provider="youtube"` OAuth row.

### Technical notes

- Google returns the granted scope set in `tokenData.scope` (already persisted as `metadata.scope`). Substring matching on the short suffix (e.g. `"gmail.send"`) is safe because Google scope strings are uniquely suffixed.
- If a user previously authorized with the full scope set (current behavior), all cards correctly light up after this change — no backfill needed.
- If `metadata.scope` is missing on legacy rows, `isServiceGranted` returns false and the user sees "Not authorized" until they re-authorize once. Acceptable since they can simply click Authorize.
- Setup-card links are static; no API calls.

