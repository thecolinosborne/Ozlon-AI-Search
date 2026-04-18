

## Goal
Make the chat function reliably surface the right tools for ANY integration query, so commands like "pull my GHL data", "list my ClickUp tasks", "check my GSC traffic", "show unread emails" all work without hitting OpenAI's 128-tool cap silently dropping the relevant tools.

## What I found

**Current prioritizer (chat/index.ts ~5531-5555):**
- Caps tools at 128 only when `tools.length > 128` (currently 175).
- Scores by keyword hints in user message: ghl/clickup/email/calendar/drive-doc-sheet-slide/youtube/gsc.
- Core 10 tools (save_memory, deep_research, web_search_google, etc.) get weight 50.
- All other tools score 0.

**Gaps:**
1. **No baseline score** → when a user says something with no integration keyword, only the 10 core tools survive ranking; the remaining 118 slots get filled by arbitrary array order. A "list my pipelines" (no `ghl` keyword) currently misses GHL tools.
2. **GHL alone has ~120 tools.** When user says "ghl", all 120 score 100, fill the 128 cap, leaving only 8 slots for core tools — email/clickup/etc. are evicted. Fine for pure-GHL turns, but combined intents ("ghl contacts + my emails") break.
3. **Detected `service_intents`** (already computed earlier in the function for context injection — see line 5031 area: "Detected service intents") is NOT passed to the tool prioritizer. That's a richer signal than raw keyword matching.
4. **"video", "doc"** are weak hints — `video` matches only the single `upload_youtube_video` tool.
5. **No telemetry** — when caps trigger, we log the hint but not which integrations got dropped, so silent failures are hard to diagnose.

## Plan

### 1. Replace the prioritizer with a tier-based ranker (chat/index.ts)
Three tiers, computed per turn:

```text
TIER A (weight 1000): integrations explicitly named OR detected via service_intents
TIER B (weight 100):  always-include core tools (save_memory, deep_research,
                      web_search_google, add_goal, work_task tools, standing_orders)
TIER C (weight 10):   baseline — every other tool gets a small score so they survive
                      when no specific intent is detected
```

Sort desc, slice 128. This guarantees:
- Pure GHL turn → all 120 ghl_ tools + 10 core + 0 fillers (current behavior preserved).
- "ghl contacts + emails" → ghl_ + email_ both Tier A, share the cap proportionally via a per-integration soft cap (max 80 per integration when 2+ are named).
- No-hint turn → core tools first, then a balanced sample of every integration.

### 2. Pass `serviceIntents` array into `runToolLoop`
The function already detects intents at ~line 5030 ("Detected service intents: [...]"). Plumb that into the prioritizer instead of re-deriving from raw text. Keep keyword fallback as backup.

### 3. Add per-integration soft cap when multiple intents detected
If 2+ intents (e.g., `['gohighlevel', 'google-mail']`), allocate at most `floor(118 / N)` slots per integration so neither starves. Core 10 always reserved.

### 4. Better keyword maps
Expand the keyword → tool-prefix matching:
- `pipeline|opportunity|contact|funnel|workflow|appointment|invoice|product|conversation` → `ghl_`
- `task|subtask|list|space|folder|sprint` → clickup
- `sheet|spreadsheet|csv|rows` → sheets
- `slide|deck|presentation` → slides

### 5. Telemetry
After capping, log: `Tools capped 175→128. Kept by integration: {ghl: 80, gmail: 11, core: 10, gsc: 4, clickup: 12, ...}`. Makes future debugging instant.

### 6. End-to-end verification
After deploy, hit each integration through the chat function with curl_edge_functions, asserting the relevant tool appears in the request and the response contains real data:
- "list my ghl pipelines" → expect ghl_list_pipelines call
- "list my clickup tasks" → expect list_clickup_tasks
- "show my unread emails" → expect list_emails
- "what's on my calendar tomorrow" → expect list_events
- "list my google drive files" → expect search_google_drive
- "show my GSC traffic" → expect gsc_query
- Combined: "pull my ghl pipelines and my clickup tasks" → both ghl_ and clickup_ tools present
- No-hint: "what can you do?" → core tools + balanced sample present

### 7. Files touched
- `supabase/functions/chat/index.ts` — replace lines ~5531-5555, add `serviceIntents` param to `runToolLoop` signature and call site.

No DB changes, no new edge functions, no UI changes. Surgical fix to one file.

