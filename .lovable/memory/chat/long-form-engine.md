---
name: Long-form engine
description: Server-side engine that detects teleprompter/speech/essay/blog requests and injects a length-contracted prompt addendum + bumps the token budget so long-form deliverables actually meet target length and read naturally.
type: feature
---
**Location:** `supabase/functions/chat/_longform/{detect.ts,prompt.ts}`, wired into `supabase/functions/chat/index.ts`.

**What it does:**
1. **Detect** (zero-latency, regex-only) — scans the last user message for kind (teleprompter, speech, voiceover, podcast, sermon, keynote, essay, article, blog, newsletter, sales_letter, story, chapter, social_thread) + length cue (duration, word count, page count).
2. **Brief** — builds a `LongFormBrief` with `target_words`, `wpm` (150 spoken / 180 podcast / 220 read), `structure`, `format`, `breath_cues`.
3. **Prompt addendum** — inserts a second system message just for this reply that:
   - States the length contract (target ± 10%, under-delivering is a failure).
   - Sets structure (scene-paragraphs / chaptered / two-column-vo / continuous prose).
   - Explicitly **overrides** the global brevity rules ("≤3-sentence paragraphs", "match the energy", 14-word cap) and the DOCUMENT MODE skeleton (Title/Executive Summary/Recommendations).
   - Bans AI-tells.
   - Requires a real closing line + italic word-count footer.
   - If length was inferred, opens with an italic "Assuming…" line so the user can correct without blocking.
4. **Token tiers** — `tokenBudgetFor(words)`: ≤400 → 16k, ≤1500 → 24k, ≤4000 → 32k, >4000 → 48k. Applied to both the tool-loop call site and the standard streaming call site. Defaults in `MODEL_REGISTRY` untouched.
5. **SSE event** — emits `event: longform\ndata: {kind, target_words, target_minutes, wpm}` up-front so the frontend can later render a live word counter + chip row (`Continue`, `Tighter`, `Longer`, `Different voice`).

**Triggers:** kind keyword + (intent verb like "write/draft/create/make/generate" OR an explicit length cue). Won't fire on incidental mentions like "I gave a speech yesterday".

**Not yet implemented (next pass):**
- Layer 2: outline-first per-beat drafting (biggest remaining quality lever).
- Layer 3: verifier pass with one repair round.
- Layer 4: voice cloning via top-K wisdom_memories exemplars.
- Frontend: live word counter + chip row reading the `longform` SSE event.

**Why it exists:** Asking for a "15-minute teleprompter" was returning ~400 clipped words with headings and bullets, because the system prompt's CONVERSATIONAL brevity rules and DOCUMENT MODE skeleton both fired for any long request, and the model had no length contract telling it 15 min ≈ 2,250 words.
