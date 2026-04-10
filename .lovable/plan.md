

# Fix Maton Integration Gaps — Full Service Coverage

## The Problem

You have **12 active Maton connections** but only about half of them have read fetchers and write tools wired up. The AI can see Gmail, Calendar, Drive, and GSC data, but it's completely blind to YouTube, Google Meet, Google Docs, Sheets, Slides, and has a broken analytics connection. It also can't take actions (create, edit) on those services.

The Google 404 links are likely from the AI returning API resource IDs or malformed URLs instead of proper user-facing links.

## What's Broken / Missing

| Connected Service | Can Read? | Can Write? | Issue |
|---|---|---|---|
| Google Mail | Yes | Yes | Working |
| Google Calendar | Yes | Yes | Working |
| Google Drive | Yes | Search only | Working |
| Google Search Console | Yes | N/A | Working |
| Google Analytics | **No** | N/A | Name mismatch: connection is `google-analytics-data`, fetcher uses `google-analytics` |
| Google Docs | **No** | **No** | No fetcher or tools |
| Google Sheets | **No** | **No** | No fetcher or tools |
| Google Slides | **No** | **No** | No fetcher or tools |
| YouTube | **No** | **No** | No fetcher or tools |
| Google Meet | **No** | **No** | No fetcher or tools |
| ClickUp | **No** | **No** | Generic fetcher with wrong endpoint, no write tools |

## What Gets Fixed

### 1. Add read fetchers for all missing services
- **Google Docs**: List recent docs, read doc content
- **Google Sheets**: List spreadsheets, read sheet data
- **Google Slides**: List presentations
- **YouTube**: List channel videos, analytics
- **Google Meet**: List upcoming/recent meetings
- **ClickUp**: List spaces, tasks
- **Google Analytics**: Fix name mapping (`google-analytics-data` → proper fetcher)

### 2. Add write/action tools for missing services
- **Google Docs**: `create_google_doc`, `append_to_google_doc`
- **Google Sheets**: `create_google_sheet`, `append_sheet_rows`, `read_sheet_data`
- **Google Slides**: `create_google_presentation`
- **YouTube**: Read-only (no write API via gateway)
- **Google Meet**: Read-only (meetings created via Calendar)
- **ClickUp**: `create_clickup_task`, `list_clickup_tasks`

### 3. Fix service detection keywords
Add keyword detectors for: docs, sheets, slides/presentations, youtube/videos, meet/video calls, clickup/tasks

### 4. Fix Google 404 links
Ensure all tool results that return links use `webViewLink` or `htmlLink` fields and construct proper user-facing Google URLs (e.g., `https://docs.google.com/document/d/{id}/edit`) instead of raw API resource IDs.

### 5. Fix analytics name mismatch
Map `google-analytics-data` connection name to the correct fetcher, and add proper GA4 data fetching (runReport endpoint).

## Files Changed

- **`supabase/functions/chat/index.ts`** — All changes in this single file:
  - Add ~6 new read fetcher functions
  - Add ~6 new write tool definitions + execution handlers
  - Add service detector keywords for missing services
  - Fix analytics connection name mapping
  - Fix URL construction in tool results
  - Update `SERVICE_FETCHERS` and `MATON_ACTION_TOOLS` registries

## What Won't Change

- Existing working integrations (Gmail, Calendar, Drive, GSC, GHL) stay untouched
- The Maton proxy edge function stays the same
- Frontend code stays the same — tools are dynamically discovered based on connections
- Database schema stays the same

