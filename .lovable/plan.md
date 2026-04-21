

## Split Google Workspace into Per-Service Integration Cards with Category Filter

The current single "Google Workspace" card on `/integrations` will be split into 10 individual cards (one per Google service), all sharing a single OAuth connection underneath. A category filter at the top of the Integrations page lets users narrow to "Google Apps" or other groups.

### Architecture (no breaking backend changes)

All 10 Google services already share **one** `integration_connections` row (`provider="youtube"`, OAuth tokens used by `_shared/google-token.ts`). We keep that — splitting is a UI/routing concern only. Each service card reads from the same shared OAuth state but tests/syncs its own API independently.

```text
integration_connections (provider="youtube", oauth tokens)
        │
        ├─ /integrations/youtube         → YouTube card + Data API key
        ├─ /integrations/gmail           → Gmail card
        ├─ /integrations/google-drive    → Drive card
        ├─ /integrations/google-calendar → Calendar card
        ├─ /integrations/google-sheets   → Sheets card
        ├─ /integrations/google-docs     → Docs card
        ├─ /integrations/google-slides   → Slides card
        ├─ /integrations/google-analytics→ Analytics card
        ├─ /integrations/google-search-console → GSC card
        └─ /integrations/google-tag-manager    → GTM card
```

### Changes

**1. `src/pages/Integrations.tsx` — registry + filter**
- Add a `category` field to each integration entry: `"google" | "crm" | "media" | "productivity"`.
- Replace the single "Google Workspace" entry with 10 entries (YouTube, Gmail, Drive, Calendar, Sheets, Docs, Slides, Analytics, Search Console, Tag Manager) — all `category: "google"`, each pointing at its own detail route.
- Add a horizontal pill filter bar above the grid: `All · Google Apps · CRM · Media · Productivity`. Filtering is client-side, defaults to "All".
- Status hydration: all 10 google cards read from the **same** `provider="youtube"` row in `integration_connections` (shared OAuth). Each card shows "Connected" if the shared OAuth row is connected.

**2. `src/components/integrations/GoogleServiceDetail.tsx` — new shared component**
- Generic detail page used by all 9 non-YouTube Google services. Takes config: `{ serviceId, name, icon, fnName, testAction, description, scopeNote }`.
- Sections:
  - **Header**: service name, icon, OAuth status badge (shared from the master row).
  - **Connection card**: shows "Authorized via Google Workspace OAuth" + a "Re-authorize" button that triggers the same OAuth flow (`youtube/oauth_authorize`) since all scopes live on one consent.
  - **Test connection**: button calls the service's `testAction` (e.g. `google-gmail/get_profile`) and shows success/error inline. Reuses the same pattern already in `YouTubeDetail`.
  - **Quick stats** (where available, additive only): e.g. Gmail unread count, Drive quota, Calendar count. Lazy-loaded after successful test.

**3. `src/pages/integrations/` — 9 thin route files**
- `GmailDetail.tsx`, `GoogleDriveDetail.tsx`, `GoogleCalendarDetail.tsx`, `GoogleSheetsDetail.tsx`, `GoogleDocsDetail.tsx`, `GoogleSlidesDetail.tsx`, `GoogleAnalyticsDetail.tsx`, `GoogleSearchConsoleDetail.tsx`, `GoogleTagManagerDetail.tsx`.
- Each is ~10 lines: imports `GoogleServiceDetail` and passes its config.

**4. `src/pages/integrations/YouTubeDetail.tsx` — slim down**
- Remove the embedded "Google Services" multi-row tester (lines using `GOOGLE_SERVICES`). Each service now has its own page.
- Keep YouTube-specific functionality: API key input, channel ID, upload form, sync controls, OAuth (which still authorizes the full Google Workspace scope set).
- Add a small "Other Google services" footer link grid pointing at the new per-service pages.

**5. `src/App.tsx` — add 9 new routes**
- Register the 9 new detail routes alongside the existing `/integrations/youtube`.

**6. Connect/disconnect flow (debug the current "connect failed")**
- After splitting, the YouTube page's OAuth button continues to authorize all Google scopes in one consent (no scope changes). The reported "connect failed" is most likely the API-key validation step rejecting an invalid/restricted key. Add a clearer toast that distinguishes:
  - API key invalid (HTTP 400 from `videos?chart=mostPopular`)
  - API key restricted to wrong referrer/IP (HTTP 403 + `accessNotConfigured`)
  - YouTube Data API v3 not enabled in the key's Google Cloud project (HTTP 403 + `SERVICE_DISABLED`)
- No backend logic change required — only swap the generic error string in `youtube/index.ts`'s `connect` action for one that surfaces Google's `error.errors[0].reason`.

### Out of scope

- No changes to `_shared/google-token.ts`, OAuth scope list, or the master `provider="youtube"` row schema.
- No new database migrations.
- ClickUp redundant "Sync Now" cleanup (separate request — can fold in if you want).
- No changes to the chat edge function tools — they already call each Google service's edge function directly.

### Technical notes

- Filter pills use the existing `PillButton` component for visual parity.
- `IntegrationCard` already supports any icon — the 10 lucide icons (`Youtube`, `Mail`, `HardDrive`, `Calendar`, `FileSpreadsheet`, `FileText`, `Presentation`, `BarChart3`, `Search`, `Tag`) are already imported in `YouTubeDetail.tsx`, so we'll reuse the same set.
- All 10 google cards share status — when OAuth is connected, all 10 light up green simultaneously. Disconnecting from any one card disconnects the shared OAuth (with a clear confirm dialog: "This will sign out of all Google services").
- `PROVIDER_BY_ID` map gets 9 new entries all pointing to `"youtube"` provider so hydration works without new DB rows.

