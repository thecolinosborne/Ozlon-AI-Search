

## Make YouTube its Own Integration Page (Remove Google Workspace Branding)

The `/integrations/youtube` page currently still renders as the old "Google Workspace" hub — wrong title, wrong description, and a cross-service test grid for Gmail/Drive/Calendar/etc. Now that each Google service has its own dedicated page, the YouTube page should be YouTube-only.

### Changes

**File: `src/pages/integrations/YouTubeDetail.tsx`**

1. **Header (lines 499–517)** — change both the loading-state and main `IntegrationDetailLayout`:
   - `name`: `"Google Workspace"` → `"YouTube"`
   - `description`: `"YouTube, Gmail, Drive, ... — one OAuth."` → `"Channel data, video uploads, and the YouTube Data API."`
   - `icon`: keep `Youtube`

2. **OAuth section (lines 589–658)**:
   - Rename heading `"Google OAuth Connection"` → `"Google Account (shared OAuth)"`
   - Update copy in the not-connected state from "Authorize with Google to enable YouTube uploads, Gmail, Drive, …" → "Authorize with Google to enable YouTube uploads and the Data API. The same authorization also powers Gmail, Drive, Calendar, Sheets, Docs, Slides, Analytics, Search Console, and Tag Manager — manage each from its own card on the Integrations page."
   - Update the "Authorize Google Workspace" button label → "Authorize Google"

3. **Remove the "Connected Google APIs" grid (lines 660–699)** — delete the entire block including the `GOOGLE_SERVICES` map, `serviceTests` state, `testService` function, and the `callFunction` helper. Each service now has its own detail page that handles its own test.

4. **Cleanup** — remove the now-unused imports: `Mail, HardDrive, Calendar, FileSpreadsheet, FileText, Presentation, BarChart3, Search, Tag, CheckCircle2, XCircle` (keep `Youtube`, `AlertCircle`, `Loader2`, `Upload`, `Shield`, `ChevronDown`, `ChevronUp`).

5. **Add a small footer link grid** below the OAuth section linking to the 9 sister Google service pages (Gmail, Drive, Calendar, Sheets, Docs, Slides, Analytics, Search Console, Tag Manager). Lightweight pill links — purely navigational, no test buttons.

6. **OAuth-success toast (line 253)** — change `"Google Workspace OAuth connected!"` → `"Google account connected — all services authorized"`.

### Out of scope

- No backend, OAuth scope, or `_shared/google-token.ts` changes.
- No changes to the 9 per-service detail pages (they already exist and work).
- No changes to the Integrations registry or category filter.
- The shared OAuth row in `integration_connections` (`provider="youtube"`) stays as-is — every Google service card continues to read from it.

### Technical notes

- The page-level `status` chip will continue to show "Connected" once either the API key or OAuth is present, matching the existing `isConnected` derived state.
- Removing `GOOGLE_SERVICES`, `serviceTests`, `testService`, and `callFunction` reduces ~35 lines of dead state and removes confusion about where to test each service.
- Footer pill grid uses simple `react-router-dom` `<Link>` elements styled like the existing `secondaryBtnClass` for visual parity — no new components.

