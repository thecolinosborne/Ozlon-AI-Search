

## Build: Wisdom Library — Ingest Minds, Make the OS Smarter

You already have the engine. We're building the cockpit that lets you pour intelligence into it and the wiring that pulls from it on every turn.

## What exists today (no rebuild needed)

- `knowledge_entries`, `knowledge_sources`, `wisdom_memories`, `reflection_notes` tables with pgvector
- `knowledge-ingest` edge function — takes raw text + source_person, extracts 5-20 structured insights, embeds, optionally extracts memories + reflection
- `knowledge-search` edge function — multi-scope search across knowledge/memory/reflection with weighted ranking and a ready-to-inject `context_bundle`

## What's missing (this build)

### 1. Wisdom Library page (`/wisdom`)

A new top-level page that becomes the home of the OS's brain:

- **Header**: "Wisdom Library" + count chips (`X sources · Y entries · Z memories`)
- **Add Source panel** — three input modes via tabs:
  - **Paste Text** — textarea + author/title/type fields → calls `knowledge-ingest`
  - **Upload Document** — drop a PDF/DOCX/TXT/MD/EPUB, parses client-side (pdf.js for PDF, mammoth for DOCX, plain read for TXT/MD), chunks if >50k chars, sends each chunk to `knowledge-ingest` with shared source metadata
  - **From URL** — paste article/blog URL → new edge function `knowledge-fetch-url` uses Firecrawl (already configured) to scrape clean markdown, then pipes to ingest
- **Toggles per ingest**: `Extract durable memories` (default on), `Generate reflection note` (default on)
- **Sources list** — grouped cards showing person, title, type, entry count, ingestion date, with expand-to-preview top 5 entries
- **Browse all entries** — filterable table by domain (marketing, leadership, finance…) and category (framework, principle, strategy…), with search-by-similarity input that calls `knowledge-search` and ranks results
- **Memories tab** — view + manually edit/delete `wisdom_memories` (uses existing `memoryService`)
- **Reflections tab** — read-only feed of synthesized notes with source backlinks

### 2. Chat auto-augment with library (RAG hookup)

In `supabase/functions/chat/index.ts`, before calling the model:

- Call `knowledge-search` with the user's latest message, `scope=all`, `match_count=6`, `threshold=0.5`
- If results exist, inject `context_bundle` into the system prompt under a new section:
  ```
  ## Relevant Wisdom
  The user has ingested the following knowledge that may be relevant. Cite frameworks by name when you use them.
  {context_bundle}
  ```
- Add a routing hint: any time the AI uses an ingested framework in its reply, it should attribute it (e.g. *"Per Hormozi's Value Equation…"*) — gives the user provenance and confidence
- Cost guard: skip the search if the message is <8 chars or pure greeting (regex check)

### 3. Source presets — one-click "Wisdom Packs"

A small grid above Add Source with curated starter packs (per `mem://knowledge/wisdom-engine-sources` — Hormozi, Munger, Buffett, Naval, Seth Godin, Dalio, etc.):

- Each pack is a button: "Ingest Hormozi Core" → calls a new edge function `knowledge-pack-ingest` that ships ~30 curated frameworks per author as pre-written ingest payload (no scraping, no copyright issues — original synthesized summaries)
- Marks pack as installed so it won't re-ingest
- This is the "integrate people's minds" headline feature — instant intelligence injection

### 4. Knowledge attribution chip on chat replies

Tiny UI addition: when a chat reply was augmented with ≥1 wisdom result, render a small chip beneath the message: `🧠 Drew from 3 sources` → click opens popover listing source_person + title for each used entry. The chat function returns this metadata in the response payload.

### 5. Nav entry

Add `/wisdom` to the BottomNav and CommandPalette as "Wisdom" with brain icon. Existing `MemorySettings` page stays — it manages standing orders/goals; Wisdom Library manages the knowledge corpus.

## Files

**New**:
- `src/pages/Wisdom.tsx` — the library page
- `src/components/wisdom/AddSourcePanel.tsx`
- `src/components/wisdom/SourceCard.tsx`
- `src/components/wisdom/EntriesBrowser.tsx`
- `src/components/wisdom/WisdomPackGrid.tsx`
- `src/components/wisdom/KnowledgeChip.tsx` (chat attribution chip)
- `src/services/wisdomService.ts` — wraps ingest/search/fetch-url calls
- `supabase/functions/knowledge-fetch-url/index.ts` — Firecrawl → ingest pipeline
- `supabase/functions/knowledge-pack-ingest/index.ts` — ships curated packs

**Edited**:
- `supabase/functions/chat/index.ts` — RAG augmentation block + return `wisdom_used` array
- `src/App.tsx` — `/wisdom` route
- `src/components/CommandPalette.tsx` + bottom nav — entry point
- `src/components/chat/MessageBubble.tsx` — render KnowledgeChip when `wisdom_used` present

## Verification

1. Open `/wisdom` → page renders empty state with packs visible
2. Click "Ingest Hormozi Core" → 30 entries appear, source card shows count
3. Paste a chapter from any book + author "Charlie Munger" → entries + memories + reflection generated, all visible in tabs
4. Upload a PDF → parses, chunks, ingests, source card shows total entries across chunks
5. Paste URL → Firecrawl scrapes, ingests
6. In chat, ask *"How should I price my new offer?"* → reply cites Value Equation framework, KnowledgeChip shows "Drew from 2 sources" → click reveals Hormozi entries
7. Search "leverage" in Entries Browser → ranked results across all sources
8. Conversational mode unaffected when no relevant wisdom matches (no chip shown)

## Outcome

Ozlon stops being a generic assistant with memory and becomes **a personal operating system with a curated library of minds inside it**. Every chat turn is silently enriched by everything you've ingested. Books, articles, podcasts transcripts, your own notes — all become live intelligence the AI can reach for and cite.

