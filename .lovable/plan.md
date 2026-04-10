

# Wisdom Engine -- What to Keep, What to Add, What to Skip

## What You Already Have (KEEP as-is)
- `knowledge_entries` + `knowledge_sources` tables with pgvector, RLS, and vector indexes
- `match_knowledge` SQL function for semantic search
- `knowledge-ingest` edge function (extracts frameworks from text, embeds, stores)
- `knowledge-search` edge function (standalone semantic lookup)
- Chat function already injects top 8 knowledge results into system prompt
- 148 pre-seeded entries from Hormozi, Munger, Brunson, Pelosi, AI gurus, etc.
- `memoryService.ts` client-side service (but no `memories` table exists in DB yet)

## What to ADD (new tables and functions)

### 1. `wisdom_memories` table
Your memory service references a `memories` table that doesn't exist. This is the core gap. This table stores durable facts about YOU -- preferences, patterns, business context, life details -- so the AI gets smarter over time.

### 2. `reflection_notes` table
System-generated insights distilled from conversations. After meaningful chats, the AI can produce a short reflection note summarizing what it learned -- patterns it noticed, advice it gave, themes emerging across sessions.

### 3. `chat_sessions` + `chat_messages` tables
Currently chat history lives only in the frontend (Zustand store, last 10 messages). These tables persist full conversation history with embeddings so the AI can reference past conversations.

### 4. `system_evolution_proposals` table
Safe self-improvement: the AI can propose prompt changes, memory reorganizations, or new wisdom structures, but nothing executes without your approval.

### 5. Multi-scope `knowledge-search` upgrade
Current search only hits `knowledge_entries`. Upgrade to search across memories, reflections, knowledge, and wisdom packs simultaneously with weighted ranking.

### 6. Chat function upgrade
- Store messages to `chat_messages`
- After each response, extract durable memories (facts, preferences, patterns)
- Optionally generate reflection notes
- Search memories + reflections alongside knowledge for context injection

### 7. Starter wisdom pack (separate from entrepreneur frameworks)
40-60 personal growth entries: self-discipline, emotional regulation, decision-making, execution, resilience. These are universal, not tied to a specific person.

## What to SKIP (overkill for now)

| Proposed | Why Skip |
|----------|----------|
| `knowledge_documents` + `knowledge_chunks` | You already have `knowledge_entries` which serves the same purpose. Adding a document/chunk layer is redundant -- your ingest function already chunks and embeds. Revisit only if you need to ingest 50+ page documents. |
| `wisdom_packs` + `wisdom_pack_items` as separate tables | The starter wisdom can go directly into `knowledge_entries` with a special `source_person = 'Wisdom Engine'`. No need for extra tables. |
| HNSW indexes | ivfflat is already configured and works fine at your scale (hundreds of entries). HNSW is for millions. |

## Implementation Plan

### Step 1: Database Migration
Create 4 new tables with RLS, indexes, triggers, and search functions:
- `wisdom_memories` (user facts/patterns with salience, confidence, recurrence)
- `reflection_notes` (AI-generated insights)
- `chat_sessions` + `chat_messages` (persistent conversation history)
- `system_evolution_proposals` (safe self-improvement proposals)
- New `match_wisdom_memories` and `match_reflections` SQL functions
- Update `match_knowledge` isn't needed -- it already works

### Step 2: Rebuild `knowledge-ingest`
Keep existing logic but add:
- After ingesting knowledge, optionally extract memory candidates into `wisdom_memories`
- Optionally produce a reflection note summarizing the ingested material

### Step 3: Upgrade `knowledge-search`
Add multi-scope search:
- `scope = knowledge | memory | reflection | all`
- Weighted ranking: similarity + recency + salience + confidence
- Returns grouped results with a pre-built context bundle for chat injection

### Step 4: Upgrade chat function
- Persist messages to `chat_messages` (create session if needed)
- After generating response, use AI to extract durable memories
- Update salience/recurrence on existing memories when re-accessed
- Inject memories + reflections + knowledge into system prompt
- Enhanced system prompt: long-memory strategic guide, pattern recognizer, truth-seeking advisor

### Step 5: Seed starter wisdom pack
50+ entries across: self-discipline, long-term thinking, emotional regulation, resilience, decision-making, execution, identity, relationships, health, money. Embedded and stored as `knowledge_entries` with `source_person = 'Wisdom Engine'`.

### Step 6: Update `memoryService.ts`
Point the client-side service at the new `wisdom_memories` table instead of the non-existent `memories` table.

## Files Changed/Created
- **New migration**: All new tables, RLS, indexes, search functions
- **Updated**: `supabase/functions/knowledge-ingest/index.ts`
- **Updated**: `supabase/functions/knowledge-search/index.ts`
- **Updated**: `supabase/functions/chat/index.ts` (message persistence, memory extraction, reflection generation, multi-source context injection, enhanced system prompt)
- **Updated**: `src/services/memoryService.ts` (point at real table)
- **Seed script**: Run via the ingest function to load starter wisdom

