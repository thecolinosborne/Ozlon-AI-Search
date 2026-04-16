

# Full Google Workspace: All API Functions + Restructured UI

## Overview
Expand all edge functions to cover the complete Google API surface, add new edge functions for Calendar, Sheets, Docs, Analytics, and Search Console, expand OAuth scopes, and restructure the UI into a proper Google Workspace hub.

## Part 1: Expand OAuth Scopes
**`supabase/functions/youtube/index.ts`** — add scopes:
- `calendar` + `calendar.events` (Google Calendar)
- `spreadsheets` (Google Sheets)
- `documents` (Google Docs)
- `webmasters.readonly` (Search Console)
- `analytics.readonly` (Google Analytics)

## Part 2: Expand Existing Edge Functions

### Gmail (`google-gmail/index.ts`) — add actions:
- `list_messages`, `get_message`, `send_message`, `trash_message`, `list_labels` (existing)
- **NEW**: `untrash_message` — restore from trash
- **NEW**: `modify_message` — add/remove labels
- **NEW**: `list_threads` — threaded view
- **NEW**: `get_thread` — full thread
- **NEW**: `create_draft` — save draft
- **NEW**: `list_drafts` — list drafts
- **NEW**: `send_draft` — send existing draft
- **NEW**: `delete_draft` — discard draft
- **NEW**: `reply_message` — reply with In-Reply-To / References headers
- **NEW**: `search_messages` — full Gmail search syntax
- **NEW**: `get_profile` — email address, messages total, threads total
- **NEW**: `batch_modify` — bulk label add/remove
- **NEW**: `list_history` — incremental sync via historyId

### Drive (`google-drive/index.ts`) — add actions:
- `list_files`, `search_files`, `get_file`, `download_file`, `upload_file` (existing)
- **NEW**: `create_folder` — create folder
- **NEW**: `move_file` — move between folders (update parents)
- **NEW**: `copy_file` — duplicate a file
- **NEW**: `rename_file` — rename
- **NEW**: `trash_file` — move to trash
- **NEW**: `untrash_file` — restore from trash
- **NEW**: `delete_file` — permanent delete
- **NEW**: `list_permissions` — sharing info
- **NEW**: `share_file` — add permission (reader/writer/commenter)
- **NEW**: `remove_permission` — revoke sharing
- **NEW**: `export_file` — export Google Docs/Sheets/Slides to PDF/DOCX/XLSX/CSV
- **NEW**: `get_storage_quota` — about/storageQuota

## Part 3: New Edge Functions

### Google Calendar (`google-calendar/index.ts`)
Actions:
- `list_calendars` — all user calendars
- `get_calendar` — single calendar metadata
- `list_events` — events with time range, search, pagination
- `get_event` — single event detail
- `create_event` — with attendees, location, reminders, recurrence
- `update_event` — partial update
- `delete_event` — remove event
- `quick_add` — natural language event creation
- `list_colors` — calendar color palette
- `watch_events` — set up push notifications (webhook)

### Google Sheets (`google-sheets/index.ts`)
Actions:
- `list_spreadsheets` — list via Drive (mimeType filter)
- `get_spreadsheet` — spreadsheet metadata + sheet names
- `read_range` — read cell range (A1 notation)
- `write_range` — write cell range
- `append_rows` — append to bottom of sheet
- `clear_range` — clear cells
- `create_spreadsheet` — new spreadsheet
- `add_sheet` — add tab/sheet
- `delete_sheet` — remove tab/sheet
- `batch_update` — bulk cell updates
- `get_values_batch` — read multiple ranges at once

### Google Docs (`google-docs/index.ts`)
Actions:
- `list_documents` — list via Drive (mimeType filter)
- `get_document` — full document JSON structure
- `create_document` — new blank doc
- `batch_update` — insert/delete/replace text, formatting
- `insert_text` — convenience: insert at index
- `replace_text` — find and replace
- `export_document` — export to PDF/DOCX/TXT

### Google Analytics (`google-analytics/index.ts`)
Actions (GA4 Data API):
- `list_accounts` — all GA4 accounts
- `list_properties` — properties under account
- `run_report` — custom report with dimensions, metrics, date ranges, filters
- `run_realtime_report` — real-time active users
- `batch_run_reports` — multiple reports in one call
- `get_metadata` — available dimensions and metrics

### Google Search Console (`google-search-console/index.ts`)
Actions (Webmasters API):
- `list_sites` — all verified sites
- `get_site` — site metadata
- `search_analytics` — performance data (queries, pages, countries, devices)
- `list_sitemaps` — submitted sitemaps
- `submit_sitemap` — submit new sitemap
- `delete_sitemap` — remove sitemap
- `inspect_url` — URL inspection (index status, crawl info)

## Part 4: Config Updates
**`supabase/config.toml`** — add entries:
```
[functions.google-gmail]
verify_jwt = false

[functions.google-drive]
verify_jwt = false

[functions.google-calendar]
verify_jwt = false

[functions.google-sheets]
verify_jwt = false

[functions.google-docs]
verify_jwt = false

[functions.google-analytics]
verify_jwt = false

[functions.google-search-console]
verify_jwt = false
```

## Part 5: Restructure UI
**`src/pages/integrations/YouTubeDetail.tsx`** — redesign as Google Workspace hub:
- Header: "Google Workspace" with Google icon
- **Connection section** at top: OAuth status, Authorize/Re-authorize/Disconnect buttons, redirect URI
- **Connected APIs grid**: 8 mini-cards (YouTube, Gmail, Drive, Calendar, Sheets, Docs, Analytics, Search Console), each showing service name + icon + status badge (Active/Scope Missing/API Not Enabled)
- **YouTube section**: API key input, channel settings, upload form (existing, reorganized under collapsible)
- **Gmail section**: Quick test button (list recent messages)
- **Drive section**: Quick test button (list files)
- Each new service gets a "Test Connection" button that pings a lightweight action

**`src/pages/Integrations.tsx`** — update card description to list all 8 services.

## Part 6: Manual Steps (user)
In Google Cloud Console (project 553189125514), enable:
- Gmail API
- Google Drive API
- Google Calendar API
- Google Sheets API
- Google Docs API
- Google Analytics Data API
- Google Search Console API (Webmasters API)

Then re-authorize OAuth in the app to grant all new scopes.

## Files to create/edit
- Edit: `supabase/functions/youtube/index.ts` (expanded scopes)
- Edit: `supabase/functions/google-gmail/index.ts` (13 new actions)
- Edit: `supabase/functions/google-drive/index.ts` (12 new actions)
- Create: `supabase/functions/google-calendar/index.ts` (10 actions)
- Create: `supabase/functions/google-sheets/index.ts` (11 actions)
- Create: `supabase/functions/google-docs/index.ts` (7 actions)
- Create: `supabase/functions/google-analytics/index.ts` (6 actions)
- Create: `supabase/functions/google-search-console/index.ts` (7 actions)
- Edit: `supabase/config.toml` (7 new function entries)
- Edit: `src/pages/integrations/YouTubeDetail.tsx` (full redesign as Google Workspace hub)
- Edit: `src/pages/Integrations.tsx` (card update)

