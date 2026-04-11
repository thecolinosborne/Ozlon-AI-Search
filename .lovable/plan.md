

# Sentient SEO Intelligence Engine

## What This Builds

Transform the current GSC data pull (passive 25-row summary) into an interactive, learning SEO system that:
- Queries GSC on demand with full control (dimensions, filters, date ranges, up to 1,000 rows)
- Stores SEO snapshots in the database so the AI can compare trends over time
- Cross-references GSC data with live Google search results to validate rankings
- Provides proactive insights ("your CTR on this keyword dropped 40% — here's why")
- Learns from every analysis, building an evolving SEO memory layer

## Architecture

```text
User asks about SEO
       │
       ▼
┌─────────────────┐
│  Tool Detection  │──▶ gsc_query / gsc_list_sites / web_search_google
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌───────────────────┐
│  GSC API (Maton)│     │ Google Search API  │
│  Full analytics │     │ Live SERP check    │
└────────┬────────┘     └────────┬──────────┘
         │                       │
         ▼                       ▼
┌─────────────────────────────────────────┐
│  AI Analysis Layer (in chat function)   │
│  - Compare current vs stored snapshots  │
│  - Cross-reference GSC rank vs live SERP│
│  - Identify winners, losers, opps       │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  seo_snapshots   │  ◀── persisted to DB
│  wisdom_memories │  ◀── SEO insights stored as memories
└─────────────────┘
```

## Changes

### 1. New database table: `seo_snapshots`
Stores periodic GSC data pulls so the AI can compare week-over-week, month-over-month.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | PK |
| user_id | uuid | Owner |
| site_url | text | GSC property |
| snapshot_date | date | When pulled |
| date_range_start | date | Query start |
| date_range_end | date | Query end |
| dimensions | text[] | What was queried |
| data | jsonb | Full query result rows |
| totals | jsonb | Aggregate clicks/impressions/ctr/position |
| created_at | timestamptz | Record time |

### 2. Add 4 GSC interactive tools to `MATON_ACTION_TOOLS`

- **`gsc_list_sites`** — List all verified properties with permission levels
- **`gsc_query`** — Full Search Analytics query: site URL, start/end date, dimensions (query/page/country/device/date), row limit up to 1,000, filters, aggregation type
- **`gsc_save_snapshot`** — Persist a GSC query result to `seo_snapshots` for trend tracking
- **`gsc_compare_snapshots`** — Load previous snapshots for a site and compare with current data

### 3. Add a `web_search_google` tool
Uses the Lovable AI Gateway to perform a live Google search for a keyword, returning the top 10 organic results. The AI cross-references this with GSC data to answer:
- "Am I actually ranking where GSC says I am?"
- "Who's outranking me for this keyword?"
- "What's the competitive landscape look like?"

### 4. Auto-persist SEO insights to `wisdom_memories`
After every GSC analysis, the AI generates an SEO insight memory (e.g., "ozlon.net saw a 25% CTR drop on 'ai assistant' keyword between April 1-7 vs March 25-31"). These get stored with `memory_type: 'seo_insight'` and are automatically surfaced in future conversations via the existing Wisdom Engine embedding search.

### 5. Enrich the system prompt with SEO analyst instructions
Add a dedicated section teaching the AI to:
- Always suggest saving snapshots after major analyses
- Compare current data against stored snapshots when available
- Cross-reference GSC positions with live search results
- Identify actionable patterns (rising keywords, dropping pages, CTR anomalies)
- Proactively flag opportunities ("this page gets 5,000 impressions but only 2% CTR — optimize the title")

### 6. Enhance `fetchGSCData` passive injection
- Add `page` dimension alongside `query` (top 25 pages)
- Add `date` dimension for daily trend (7 data points)
- Include aggregate totals per site
- Increase row limit from 25 to 50

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/chat/index.ts` | Add 4 GSC tools + `web_search_google` tool, handlers in `executeToolCall`, SEO system prompt section, enhanced `fetchGSCData` |
| Database migration | Create `seo_snapshots` table with RLS |

## What This Enables

- "Show me my top pages for ozlon.net last 30 days" → AI calls `gsc_query` with page dimension, returns rich data
- "Save this as a snapshot" → AI persists to `seo_snapshots`
- "Compare my performance this month vs last month" → AI loads both snapshots, calculates deltas
- "Am I actually ranking #3 for 'ai assistant'?" → AI searches Google live, cross-references with GSC position
- "What keywords should I focus on?" → AI analyzes high-impression/low-CTR keywords, suggests title optimizations
- "What changed since last week?" → AI pulls stored snapshot + fresh data, highlights movers
- Over time, the system builds a memory of every SEO trend, making each analysis smarter than the last

