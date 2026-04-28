# Signal Detail View + Scalable Signal Envelope

Two coordinated changes. The detail view is small and immediate; the envelope is the architectural piece.

---

## Part 1 — Fix signal truncation (small, ships first)

### What you see today
- Banner: `reason` clamped to 2 lines, no expander
- Indicator hover: clamped to 3 lines
- Page hero: suggestion button truncated at 260px
- Nowhere shows `evidence`, `source_ids`, `mode_context`, `confidence`, lookahead window, or the underlying wisdom memories that produced the signal

### What ships
1. **`src/components/signals/SignalDetailSheet.tsx`** *(new)*
   A right-side `Sheet` (shadcn) that opens on signal click and shows the full record:
   - Full headline + reason (no clamp)
   - Full suggested direction
   - `evidence` array rendered as a citation list (with links when source_ids resolve to emails / events / tasks)
   - Salience, confidence, kind, mode_context, lookahead window, created_at — as a meta strip
   - Linked wisdom memories (the ones from `match_wisdom_memories` that produced this signal) — fetched lazily
   - Actions: Handle / Run skill / Snooze / Dismiss / Mark wrong
2. **Edits (additive only):**
   - `SignalsBanner.tsx` — add an "Expand" affordance on the reason; clicking the card opens `SignalDetailSheet`
   - `SignalSurface.tsx` (page variant) — make the truncated suggestion button open the sheet instead of just navigating
   - `SignalSurface.tsx` (indicator) — hover preview gets a "View details" link
3. **Backend:** add `signal_moments.evidence` and `signal_moments.linked_memory_ids` to the `useSignals()` select if they're not already returned (read existing hook first; only widen if needed).

No design rewrite. Same Vision-Pro aesthetic. Sheet uses existing tokens.

---

## Part 2 — The scalable signal envelope (architecture)

### The scaling problems with the previous plan
- Inlining envelope construction in `chat/index.ts` makes a 9.5k-line file worse
- Rendering the full envelope into every system prompt burns tokens linearly per turn
- Per-turn entity matching against every account/workspace name doesn't survive 100+ accounts
- Signal logic gets duplicated between `chat`, `signals-synthesize`, `RealtimeVoiceChat`, and `Communications`

### Scalable shape

```text
                        ┌────────────────────────────────┐
                        │  signal-envelope (edge fn)     │
                        │  pure, cacheable, ~30ms        │
                        │  in:  messages, sessionId,     │
                        │       userId                   │
                        │  out: SignalEnvelope (typed)   │
                        └──────────────┬─────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                              ▼
   chat/index.ts              signals-synthesize           RealtimeVoiceChat
   (consumer)                 (consumer)                   (consumer)
```

One envelope builder, multiple consumers. Each consumer reads only the buckets it cares about.

### Why this scales

| Concern | Mitigation |
|---|---|
| Token cost in prompts | Envelope is **never serialized whole**. Each consumer renders only the slice it needs. Chat gets a 6-line "PRIORITY CONTEXT" block (top-3 signals only). Voice gets one line. |
| Per-turn latency | Builder caches the entity index per user (account names, workspace names) in a Deno KV or in-memory LRU keyed by `userId + integrations.updated_at`. Rebuilt only when integrations change. |
| Account/workspace explosion | Entity matcher uses a **trie** built once per user, not a linear scan per turn. O(message length) instead of O(accounts × message length). |
| Schema drift | `SignalEnvelope` lives in `_shared/signals/types.ts`. All consumers import the type — TS catches drift at build. |
| Adding a new bucket later | New buckets are additive fields. Old consumers ignore them. No migration. |
| Adding a new consumer (e.g., communications) | Consumer imports the builder, asks for the envelope. Zero changes to other consumers. |

### What ships

**New files**
- `supabase/functions/_shared/signals/types.ts` — `SignalBucket`, `SignalPriority` (`direct|active|durable|contextual|recent|inferred|background|uncertain`), `Signal`, `SignalEnvelope`
- `supabase/functions/_shared/signals/builder.ts` — pure `buildSignalEnvelope(input)`. No network. Caller passes already-loaded data (messages, profile, session, integrations snapshot).
- `supabase/functions/_shared/signals/entities.ts` — trie-based account/workspace name matcher. Cached per user in module-scope `Map<userId, {builtAt, trie}>`.
- `supabase/functions/_shared/signals/intent.ts` / `importance.ts` / `interaction.ts` — the A/C/E bucket classifiers (deterministic verb/cue tables). Reuse existing `classifyMessage()` for B (context).
- `supabase/functions/_shared/signals/render.ts` — formatters: `renderForChatPrompt(env, {topN: 3})`, `renderForVoice(env)`, `renderForUI(env)`. Each consumer picks one.

**Edits (small, surgical)**
- `supabase/functions/chat/index.ts` — ~20 added lines: build envelope, call `renderForChatPrompt(env)`, append to system prompt, replace the ad-hoc GHL account-string scan with `pickAccountByPriority(env, 'ghl')`. The existing classifier and Infinity Router stay exactly as-is.
- `supabase/functions/signals-synthesize/index.ts` — accept the envelope when chat passes it; otherwise build its own. Lets synthesis prioritize moments that align with the user's current intent bucket.
- `RealtimeVoiceChat` (frontend) — fetches the envelope once on session start via a thin `signals-envelope` edge fn read endpoint, uses `renderForVoice(env)` to seed the realtime context.

**Frontend (additive, off by default)**
- `src/components/signals/EnvelopeDebugDrawer.tsx` — visible only when `?debug=signals` is set or toggled in `Developer.tsx`. Streams `event: signal_envelope` from chat SSE.

**Memory**
- `mem://architecture/signal-envelope` — documents the 8-priority hierarchy, 5 buckets, builder/consumer split, caching strategy.
- Index update under Architecture & Stability.

### Out of scope (next pass once this lands)
- Persisting envelopes to DB for analytics
- Generalizing the GHL guardrail to ClickUp/Slack (envelope already exposes the data; it's a 5-line per-integration change)
- User-facing "treat this as urgent" override mid-turn

---

## Order of operations

1. **Detail Sheet** (Part 1) — ~1 file new, 3 small edits. Independently shippable.
2. **Envelope plumbing** (Part 2) — types + builder + render, no consumer wiring yet.
3. **Wire chat consumer** — replace the ad-hoc GHL account scan with `pickAccountByPriority`. This is the moment the new architecture earns its keep.
4. **Wire voice + synthesis consumers** — last, once chat proves it.

Each step is independently mergeable. Nothing forces a big-bang switch.
