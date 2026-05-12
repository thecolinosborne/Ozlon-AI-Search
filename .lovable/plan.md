## Ozlon Research — Phase 1

A research engine that answers like Perplexity, but fuses your personal context (Gmail, Calendar, Wisdom) and remembers every answer as a living thread. Phase 1 lives **inside the existing chat** — no new page, no UI rewrites. Additive only.

### What you'll be able to do after Phase 1

1. Ask any research question in chat ("research X", "deep dive on Y", "who is Z").
2. Get a cited Research Card inline with: synthesized answer, source cards, personal-context callouts ("from your inbox…", "your Wisdom says…"), confidence level, and follow-up suggestions.
3. Tap "Save as living thread" → it persists in the Wisdom Engine and can be re-opened later with a freshness diff.
4. Voice works the same — ask aloud, get a narrated cited brief.

### Architecture

```text
User asks in chat
        │
        ▼
chat/index.ts detects research intent  ──►  routes to new tool: run_research
        │
        ▼
supabase/functions/research/index.ts  (new edge function)
        │
        ├── 1. Plan: classify query → fast | deep | personal
        ├── 2. Fan-out (parallel):
        │       • Web layer  → Perplexity Sonar (fast cited)  +  Tavily/Firecrawl (deep crawl)
        │       • Personal layer → Gmail search, Calendar, Wisdom pgvector retrieval
        ├── 3. Synthesize → gpt-5.4 merges web + personal into one cited brief
        ├── 4. Persist → research_reports + research_sources tables
        └── 5. Return Research Card payload (artifact)
                │
                ▼
ChatMessageList renders <ResearchCard /> artifact
```

### Backend

**New edge function:** `supabase/functions/research/index.ts`
- Accepts `{ query, mode?: "fast"|"deep"|"personal", saveAsThread?: boolean }`
- Router picks providers per mode
- Returns `{ reportId, answer, sources[], personalContext[], confidence, followUps[] }`

**New connector:** Perplexity Sonar via existing standard connector (`perplexity`). Gemini grounding + Tavily + Firecrawl already wired.

**New tool registered in chat:** `run_research` — wired into the existing tool loop in `supabase/functions/chat/index.ts` so the AI calls it automatically when intent matches.

**System prompt addition:** small block instructing the AI to call `run_research` for "research / deep dive / look up / find me / who is" patterns instead of answering from training data.

### Database (one migration)

Two tables, both RLS'd to `auth.uid()`:

- `research_reports` — query, answer (markdown), mode, confidence, is_living_thread, last_refreshed_at, embedding (pgvector for Wisdom retrieval)
- `research_sources` — report_id, url, title, snippet, source_type ('web'|'gmail'|'calendar'|'wisdom'), relevance_score

### Frontend (additive, no redesigns)

**One new artifact component:** `src/components/chat/ResearchCard.tsx`
- Translucent card matching Vision Pro language
- Header: query + confidence chip
- Body: cited answer (markdown, citation pills inline)
- Source rail: horizontal scroll of source cards (web favicon, gmail icon, calendar icon, wisdom icon)
- Footer: "Save as living thread" toggle + follow-up chips

**Wired into existing renderer:** `ChatMessageList.tsx` detects `artifact.type === 'research'` and renders `<ResearchCard />`. No changes to message bubbles, voice, or composer.

**Voice:** zero work needed — existing TTS auto-plays the answer field, existing voice input already feeds chat.

### Out of scope (saved for Phase 2)

- Dedicated `/research` page and history library
- Morning auto-brief / scheduled research
- Living-thread auto-refresh diffs (we save the thread now; the diff engine is Phase 2)
- "Research everyone on tomorrow's calendar" batch command
- Shareable public report links

### Files touched

- **New:** `supabase/functions/research/index.ts`
- **New:** `src/components/chat/ResearchCard.tsx`
- **New:** migration for `research_reports` + `research_sources`
- **Edit (additive):** `supabase/functions/chat/index.ts` — register `run_research` tool + intent hint
- **Edit (additive):** `supabase/functions/_shared/integrations/research.ts` — add Perplexity Sonar route
- **Edit (additive):** `src/components/chat/ChatMessageList.tsx` — render new artifact type
- **Connector:** link Perplexity via `standard_connectors--connect`

### Why this is the right Phase 1

It ships the core moat (personal-context fusion + persistent research) inside one screen the user already uses, with zero UI risk, in the smallest possible surface area. Everything in Phase 2 (page, morning brief, diffs) plugs into the same `research_reports` table without rework.
