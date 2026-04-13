

# Ozlon Research Agent — Backend Tool + Database

## Concept
The Research Agent is a new tool inside the existing chat edge function — an "infinity stone" that Ozlon can invoke from any conversation. When you say "research competitor analysis for X" or "deep dive on Y," Ozlon calls Tavily for real web search results, then synthesizes them into a structured report using the AI, saves it to a `research_tasks` table, and can cross-reference with other tools (email, SEO, memory).

## Architecture

```text
User: "Research the latest trends in AI agents"
  → Chat Edge Function detects research intent
  → Calls `deep_research` tool
  → Tavily API (real web search, 8 sources)
  → GPT synthesizes structured report
  → Saves to research_tasks table
  → Returns formatted report in chat
  → Optional: "Save to Memory" extracts key findings
```

## Implementation

### Step 1: Add TAVILY_API_KEY secret
You provide the API key from tavily.com when prompted.

### Step 2: Create `research_tasks` table
- id, user_id, query, status (queued/running/complete/failed), report (markdown text), sources (jsonb array of {url, title, snippet}), created_at, completed_at
- RLS: users can only access their own research tasks

### Step 3: Add `deep_research` tool to chat edge function
- New tool definition with parameters: `query` (what to research), `search_depth` (basic/advanced), `max_results` (default 8)
- Tool handler:
  1. Creates a `research_tasks` row with status `running`
  2. Calls Tavily API: `POST https://api.tavily.com/search` with `{query, search_depth: 'advanced', max_results: 8, include_answer: true, include_raw_content: false}`
  3. Takes results (titles, URLs, content snippets)
  4. Calls GPT with a research analyst prompt to synthesize: Executive Summary, Key Findings (5-8 bullets with [source N] citations), Detailed Analysis, Conflicting Information, Sources & Confidence rating
  5. Updates `research_tasks` with the report, sources, status `complete`
  6. Returns the formatted report to the chat
- Mapped as `'_always_'` in TOOL_APP_MAP (no Maton connection needed)
- Display name: `'Researching the web'`

### Step 4: Update system prompt
- Add research instructions: "You have a `deep_research` tool that performs real web searches using Tavily and synthesizes findings into structured reports. Use it when users ask you to research, investigate, analyze a topic, find information about something, or do a deep dive. Always offer to save key findings to memory after delivering a report."

### Step 5: Add research intent keywords
- Add to `actionKeywords`: research, investigate, deep dive, look into, find out about, what's the latest on, analyze the market, competitor analysis

### No separate UI page
The research tool lives inside the chat — Ozlon invokes it naturally. Research history is stored in the database and can be recalled. The existing quick actions bar could get a "Research" chip added.

## Files Changed
- `supabase/functions/chat/index.ts` — add `deep_research` tool definition, handler, display name, app map entry, system prompt update, action keywords
- Database migration — create `research_tasks` table with RLS

## What You Need
- TAVILY_API_KEY from tavily.com (I'll prompt you for it)

