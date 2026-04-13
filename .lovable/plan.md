

# Add Automatic Skill Learning to Chat

## What this does
After every conversation turn, the AI will automatically extract and save durable learnings — preferences, patterns, corrections, and workflows — so it genuinely improves over time. When you say "always convert Drive links to direct download URLs," it will remember that permanently.

## Current state
- `wisdom_memories` table exists with vector embeddings
- Chat function **reads** memories via `match_wisdom_memories` and injects them into context
- `knowledge-ingest` function can **write** memories but is never called from chat
- **No automatic extraction** happens during conversation — the AI cannot learn from your interactions

## Implementation

### 1. Add a `save_memory` tool to the chat function (`supabase/functions/chat/index.ts`)
- Register a new tool in the tool list: `save_memory` with parameters `memory_type`, `content`, `summary`, `salience`
- When the AI decides something is worth remembering (a preference, correction, workflow pattern), it calls this tool
- The tool handler generates an embedding via OpenAI and inserts into `wisdom_memories`
- This is lightweight — no extra AI call needed since the model itself decides what to save

### 2. Add a post-conversation memory extractor (same file)
- After `onDone` / stream completion, run a background pass on the last few messages
- Use a small prompt to extract any implicit learnings the AI didn't explicitly save
- Examples: "User corrected me about Drive URLs," "User wants confirmations before destructive actions"
- Insert extracted memories with embeddings into `wisdom_memories`
- This catches things the AI forgot to explicitly `save_memory` on

### 3. Update the system prompt to instruct memory usage
- Tell the AI: "When the user states a preference, correction, or reusable pattern, call `save_memory` to persist it"
- Tell the AI: "Reference your LIVING MEMORY section before answering — if you already know a preference, apply it without asking"

### 4. Add deduplication
- Before inserting a new memory, do a vector similarity check against existing memories
- If similarity > 0.9, update `recurrence_count` and `confidence` on the existing memory instead of creating a duplicate
- This prevents the memory table from filling with near-identical entries

## Files changed
- `supabase/functions/chat/index.ts` — add `save_memory` tool + post-turn extraction + dedup logic
- No frontend changes needed — this is entirely backend

## What it looks like in practice
- You say: "Always convert Google Drive links to direct download URLs"
- AI calls `save_memory({ memory_type: "preference", content: "User wants Google Drive share/view links auto-converted to direct download format (uc?export=download&id=FILE_ID) for uploads and automations", summary: "Auto-convert Drive links to direct download URLs" })`
- Next time you share a Drive link, the AI sees this in its LIVING MEMORY and applies it automatically without being told

