

## Event Research & Calendar Scraping Feature

### What You Get
A new "Events" capability where you can ask the AI to find networking events, conferences, and meetups from the web — and see them in a clean upcoming-dates list. The AI will scrape event pages, extract dates/details, and store them for reference.

### Architecture

```text
User asks: "Find networking events in LA for June 2026"
  → Chat AI triggers deep_research + new scrape_events tool
  → Tavily finds relevant event pages
  → Firecrawl scrapes full event details (dates, venues, links)
  → Events stored in `discovered_events` table
  → UI shows upcoming events list on dashboard or dedicated page
```

### Implementation Steps

**1. Connect Firecrawl for website scraping**
- Link the Firecrawl connector to the project (it's available in the connector catalog)
- This gives the edge function the ability to scrape full web pages for structured event data

**2. Create `discovered_events` database table**
- Columns: `id`, `user_id`, `title`, `description`, `event_date`, `end_date`, `location`, `url`, `source`, `category` (networking/conference/meetup), `metadata`, `created_at`
- RLS: users see only their own events

**3. Add `scrape_events` tool to the chat edge function**
- New tool definition alongside `deep_research`
- Flow: takes a URL or search query → uses Firecrawl to scrape the page → uses AI to extract structured event data (title, date, location, URL) → inserts into `discovered_events`
- Falls back to Tavily + AI extraction if Firecrawl isn't available

**4. Add `list_events` tool to the chat edge function**
- Queries `discovered_events` for upcoming dates, filterable by category and date range
- AI can present them conversationally

**5. Build Events UI component**
- New `/events` page or dashboard card showing upcoming discovered events
- Sorted by date, with category filters
- Each event shows: title, date, location, source link
- Calendar-style view option using the existing Calendar component

**6. Calendar integration (future-ready)**
- The `fetchCalendar` stub in `src/core/hooks/integrations.ts` is already defined
- Wire it to Google Calendar via the Maton API gateway (already connected) to pull personal calendar events alongside discovered web events

### Changed Files
| File | Change |
|---|---|
| `supabase/functions/chat/index.ts` | Add `scrape_events` and `list_events` tool definitions + handlers |
| New migration | Create `discovered_events` table with RLS |
| `src/pages/Events.tsx` | New events listing page |
| `src/App.tsx` | Add `/events` route |
| `src/components/navigation/BottomNav.tsx` | Add Events nav item |

### Dependencies
- Firecrawl connector must be linked first (I'll prompt you to connect it)
- Tavily is already configured as fallback

