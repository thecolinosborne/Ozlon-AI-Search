---
name: Signals — wisdom-fused awareness layer
description: /signals route surfacing 0–3 distilled "moments" via gauntlet-router (provider=openai), with read/write fusion into the Wisdom Engine
type: feature
---
**Architecture:** Signals is the surfacing layer of the Wisdom Engine, not a parallel system.

**Tables:** `signal_moments` (with embedding for dedup), `user_context_state` (mode + quiet hours).

**Edge functions:**
- `signals-synthesize` — embeds context, recalls `match_wisdom_memories` + `match_reflections(note_type='signal_feedback')`, calls `gauntlet-router` with `node_type=signals-synthesize` and `cost_sensitivity=low` (routes to OpenAI per user requirement, not Lovable AI default), uses `emit_moments` tool schema, dedups via `match_signal_moments` (>0.88 similarity), enforces `wisdom_memories.memory_type='signal_throttle'` caps. Returns 0–3 moments — silence is the correct default.
- `signals-feedback` — on act/ignore/dismiss: updates lifecycle, writes `reflection_notes(note_type='signal_feedback')`, promotes to `wisdom_memories(memory_type='signal_pattern')` after 3 same-kind+outcome events in 14d, files `system_evolution_proposals(proposal_type='signal_throttle')` after 5 ignores.

**Frontend:** `useSignals()` hook + `<SignalSurface variant="page|indicator|inline">` component (surface-agnostic from day one — Phases C/D mount different variants without new components). `Signals` page at `/signals`, nav entry under Communications. "Handle it" navigates to `/?intent=…&signal=…` to bridge into chat orchestration.

**Voice rules in synthesis prompt:** ≤14 word headlines, no emoji, no exclamation, calm Jarvis tone. Mode-aware (focus → silence unless salience≥0.9, idle → ≤1 reflective, planning → up to 3, reactive → ≤2 directive).
