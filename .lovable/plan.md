# Route Signals Intelligence through The Brain (Gauntlet) + Evolution Layer

## Why this matters

`signals-synthesize` already routes through `gauntlet-router` (The Brain), but the **new user-created signal flow** I proposed last turn would have called Lovable AI Gateway directly — bypassing The Brain. Wrong instinct for a product whose whole point is that the system picks the best stone (OpenAI / Gemini / Anthropic / xAI / DeepSeek / Mistral) per task.

This plan does two things:
1. **Force every signal-side AI call through `gauntlet-router`** — classification, drafting, validation, intent inference. No direct gateway calls anywhere in the signals stack.
2. **Make the Brain *learn* from signal outcomes** so routing actually evolves with use.

---

## Part 1 — Brain-routed user signals

### `supabase/functions/signals-create/index.ts` (new)
- **No direct `ai.gateway.lovable.dev` calls.** Uses `_shared/gauntlet-call.ts`.
- `gauntletCall({ agent: "signals-create", node_type: "signals-create", needs: { modality: "text", complexity: "low", latency_priority: "fast", cost_sensitivity: "high" }, tools: [classify_signal] })` — router picks cheapest capable stone.
- Tool `classify_signal` returns: `signal_type` (`message | task | reminder | thought`), `headline` (≤14 words), `salience` (0–1), `priority`, `suggested_action`, `target_integration` (gmail | slack | clickup | calendar | none).
- Embeds via `text-embedding-3-small`, calls `match_signal_moments(>0.82)` to merge dupes, else inserts with `kind="user_created"`, `metadata.brain_stone`, `metadata.brain_latency_ms`, `metadata.routing_reason`.

### `supabase/functions/signals-feedback/index.ts` (extend)
- New outcomes: `validate`, `start_task`, `start_message`, `complete`, `snooze`.
- `start_task` → inserts `work_tasks` row, links via `signal_moments.metadata.task_id`.
- `start_message` → calls `communications-draft` (already Brain-routed).
- `validate` → flips `metadata.validated=true`, writes `reflection_notes(note_type='signal_validation')` so tuner learns "user trusts this kind".
- All AI summarization goes through `gauntletCall`, never direct gateway.

### Migration `<ts>_signals_user_created.sql`
- Allow `kind='user_created'` and `kind='digest'` in any check constraints.
- Partial index `idx_signal_moments_user_kind_status` on `(user_id, kind, status)`.

---

## Part 2 — Brain evolution from signal outcomes

### Extend `signals-tune` (already cron hourly)
- Aggregate `signal_moments.metadata.brain_stone` × outcome from `reflection_notes(note_type='signal_feedback')` over 14d.
- Per-`node_type` (`signals-create`, `signals-synthesize`, `signals-feedback`) **stone scorecards**: acted/dismissed ratio + median latency + cost.
- Write one `wisdom_memories(memory_type='brain_routing_pref')` row per user:
```json
{ "signals-create": { "preferred_stones": ["gemini-2.5-flash","gpt-5-mini"], "avoid": ["gpt-5"], "reason": "user acted 4/5 on flash, ignored 3/3 on gpt-5" } }
```

### `gauntlet-router` (additive)
- On `action: "call"`, when `node_type` starts with `signals-`, look up the user's `brain_routing_pref` and apply soft preference (boost preferred +0.15, deboost avoid −0.2) **before** the existing scorer.
- Log decision into `routing_decisions` with `reason: "evolved: user pattern N/M"` so the Brain page surfaces it — user literally watches it learn.

### Optional polish — `src/pages/ModelRouting.tsx`
- "Evolved preferences" subsection under Usage reading `brain_routing_pref`, e.g. *"For signals: preferring Gemini Flash (4/5 acted)"*.

---

## Part 3 — UI for user-created signals

**`src/pages/Signals.tsx`**
- Capture composer (textarea + "Capture") above the hero → `useSignals().createSignal(text)`.
- New "Your captures" section for `kind="user_created"` with inline chips: **Validate** · **Start as task** · **Draft message** · **Complete** · **Dismiss**.

**`src/components/signals/SignalSurface.tsx`**
- Render `user_created` with subtle brain-stone metadata line (e.g. "Gemini Flash") — reinforces that Brain triaged it.

**`src/hooks/useSignals.ts`**
- Add `createSignal(text)`, `validate(id)`, `startAsTask(id)`, `startAsMessage(id)`, `complete(id)`. Optimistic update + refresh.

---

## Files

**New**
- `supabase/functions/signals-create/index.ts`
- `supabase/migrations/<ts>_signals_user_created.sql`

**Modified**
- `supabase/functions/signals-feedback/index.ts` — new outcomes, AI via `gauntletCall`
- `supabase/functions/signals-tune/index.ts` — brain stone scorecards → `brain_routing_pref`
- `supabase/functions/gauntlet-router/index.ts` — apply `brain_routing_pref` for `signals-*`, log evolution reason
- `src/hooks/useSignals.ts` — capture/validate/start helpers
- `src/pages/Signals.tsx` — composer + "Your captures" section
- `src/components/signals/SignalSurface.tsx` — render user_created with brain stone metadata
- `src/pages/ModelRouting.tsx` — "Evolved preferences" subsection (optional)

---

## Guarantees
- **Zero direct calls** to `ai.gateway.lovable.dev` from any signals function. Every model call goes through `_shared/gauntlet-call.ts` → `gauntlet-router`.
- Additive only — real-time, lookahead, daily-digest, and tuning passes untouched.
- Evolution is per-user and reversible (delete the `brain_routing_pref` row to reset).