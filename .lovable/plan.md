

## Wisdom Library → Cosmic Orchestration Integration

Right now Wisdom is bolted onto the side: the chat function does its own one-shot RAG lookup at the start of each turn. That's a flashlight, not gravity. To make it part of the orchestration — felt by every agent, every router, every tool decision — we wire it into the **Infinity Router** (the pre-processing brain) and the **agent registry** so wisdom *shapes routing decisions, tool selection, and agent persona*, not just reply text.

## What changes

### 1. Wisdom becomes a first-class signal in the Infinity Router

The Infinity Router (`supabase/functions/chat/index.ts` orchestration layer) currently does 6-path Gemini pre-processing for intent, identity, etc. Add a **7th path: Wisdom Resonance**.

- Runs in parallel with the other router paths (no latency cost — they're already concurrent)
- Calls `match_knowledge` + `match_wisdom_memories` + `match_reflections` against the user message *plus* the resolved intent
- Returns a structured `wisdom_signal`:
  ```
  {
    resonant_sources: [{id, person, title, similarity}],
    dominant_domains: ['negotiation', 'pricing'],
    framework_hits: ['Value Equation', 'First Principles'],
    confidence: 0.82
  }
  ```
- This signal is passed into every downstream stage, not just the system prompt

### 2. Wisdom-aware agent routing

In `src/core/orchestrator.ts` and the agent dispatcher, the routing decision (which agent handles the turn) currently uses intent only. Upgrade it:

- `wisdom_signal.dominant_domains` becomes a tiebreaker and amplifier
- Example: intent = "general advice" + dominant_domain = "negotiation" → route to a Negotiation specialist persona instead of base agent
- New helper `selectAgentWithWisdom(intent, wisdomSignal)` in `src/core/agents/index.ts`

### 3. Wisdom-shaped system prompt (structured, not appended)

Currently the chat function appends a `## Relevant Wisdom` block. Restructure into three named blocks the model treats differently:

- **`## Active Frameworks`** — the named frameworks (Value Equation, etc.) the model is *expected to apply by name*
- **`## Personal Memories`** — durable memories from `wisdom_memories` (user's own facts/preferences) framed as ground truth
- **`## Reflections`** — synthesized notes framed as prior conclusions

Each block carries source IDs so attribution survives. Plus a routing instruction: *"Cite frameworks by name. If a Personal Memory contradicts a Framework, the Memory wins."*

### 4. Tool selection biased by wisdom

When `enableTools: true` and `wisdom_signal.framework_hits` includes operational frameworks (e.g. anything tagged `domain: ops` or `domain: marketing`), the tool list passed to the model is reordered so domain-relevant tools (GHL, Maton, Calendar, etc.) appear first. Models honor tool ordering when choosing. Implemented as a small `prioritizeToolsByDomain(tools, domains)` helper in the chat function.

### 5. Plug-state honored end-to-end

Every wisdom query in steps 1-4 filters by `knowledge_sources.is_active = true` (the plug toggle). Pulling a stone instantly removes its influence from routing, prompt, *and* tool ordering — not just the citation block.

### 6. Telemetry: prove it's orchestrating

Emit a new SSE event `orchestration_trace` once per turn containing:
```
{
  intent, agent_chosen, wisdom_signal,
  frameworks_injected: [...], memories_injected: [...],
  tools_reordered: bool
}
```
Client stores it on the message; new debug-only chip "Show orchestration" (visible when developer mode is on) opens a popover with the full trace. This is how you *see* the gravity.

### 7. Wisdom feedback loop (closes the orchestration ring)

After the model replies, a lightweight post-turn task:
- If the model cited a framework → increment `recurrence_count` and `last_accessed_at` on the relevant `knowledge_entries` / `wisdom_memories` (already-existing columns)
- High-recurrence entries get boosted similarity in future matches (multiply score by `1 + log(recurrence_count) * 0.05`)
- This is the gravitational compounding: the more a piece of wisdom proves useful, the more it pulls future turns toward itself

### 8. Settings & Wisdom page surfaces

- Wisdom page header gets a live "Orchestration: Active · Influencing routing" indicator (green dot when ≥1 source is plugged)
- Settings → Wisdom card shows new line: `Frameworks influencing chat: N`

## Files

**Edited**:
- `supabase/functions/chat/index.ts` — add 7th router path, structured wisdom blocks, tool prioritization, SSE trace event, post-turn recurrence updates, plug filter on all queries
- `src/core/orchestrator.ts` — accept and apply `wisdom_signal` in routing
- `src/core/agents/index.ts` — `selectAgentWithWisdom` helper
- `src/hooks/useChatStream.ts` — parse `orchestration_trace` SSE event
- `src/components/chat/MessageBubble.tsx` — orchestration trace popover (dev mode)
- `src/pages/Wisdom.tsx` — orchestration-active indicator
- `src/components/settings/WisdomLibraryCard.tsx` — frameworks-influencing line
- `src/services/wisdomService.ts` — `getActiveSourceCount()`, `getInfluencingCount()`

**No new tables, no new edge functions.** All wiring uses existing schema (`recurrence_count`, `last_accessed_at`, `is_active` already exist on the wisdom tables).

## Verification

1. Plug in a Hormozi pack, ask "how should I price my new offer" → orchestration trace shows `framework_hits: ['Value Equation']`, agent persona shifted, reply cites the framework by name
2. Unplug Hormozi mid-session, ask same question → trace shows empty `framework_hits`, no citation, generic reply
3. Plug it back in, ask 5 more pricing questions → `recurrence_count` on Value Equation entry increments each turn (verify in DB)
4. Ingest a personal memory ("I prefer recurring revenue over one-time sales") → next pricing question, the memory appears in `## Personal Memories` block and reply respects it even when a framework would suggest otherwise
5. Wisdom page shows "Orchestration: Active" green dot when sources plugged, neutral when all unplugged
6. Settings card shows accurate "Frameworks influencing chat: N" count
7. Dev-mode message popover reveals full orchestration trace (intent, agent, wisdom signal, tool reorder)
8. Empty library → orchestration runs cleanly, no errors, no trace clutter

## Outcome

Wisdom stops being a citation feature and becomes the gravitational core of every turn: it bends routing, persona, tool selection, and prompt structure simultaneously. Plug a mind in → the entire orchestration tilts toward it. Pull it out → influence vanishes instantly, capability remains. The system gets measurably smarter the more you use the wisdom you've ingested, because frequently-cited entries gain pull over time. That's the cosmic orchestration — every component in unison, weighted by what's plugged in.

