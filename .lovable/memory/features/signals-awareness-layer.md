---
name: Signals — wisdom-fused awareness layer
description: /signals route surfacing 0–3 distilled "moments" via gauntlet-router (provider=openai), with read/write fusion into the Wisdom Engine
type: feature
---
**Architecture:** Signals is the surfacing layer of the Wisdom Engine, not a parallel system.

**Tables:** `signal_moments` (with embedding for dedup), `user_context_state` (mode + quiet hours).

**Edge functions:**
- `signals-synthesize` — three modes via `?mode=`:
  - default (`now`) — real-time pass. Embeds context, recalls `match_wisdom_memories` + `match_reflections(note_type='signal_feedback')`, calls `gauntlet-router` (`node_type=signals-synthesize`, `cost_sensitivity=low` → OpenAI), uses `emit_moments` tool, dedups via `match_signal_moments` (>0.88), enforces `wisdom_memories.memory_type='signal_throttle'` caps. 0–3 moments — silence is correct default.
  - `lookahead` (per-user, JWT) — Phase B anticipation pass. Pulls Google Calendar events 24h–7d ahead via `getGoogleAccessToken` + tasks with `due_at` in window, asks GPT for ≤2 `risk`/`opportunity` moments only. Skips `focus` mode and quiet hours.
  - `lookahead_tick` (cron, gated by `x-cron-key`/`SIGNALS_CRON_KEY` env, defaults to service role) — fans out lookahead to up to 50 users active in last 7d (via `user_context_state.last_interaction_at`).
- `signals-feedback` — on act/ignore/dismiss: updates lifecycle, writes `reflection_notes(note_type='signal_feedback')`, promotes to `wisdom_memories(memory_type='signal_pattern')` after 3 same-kind+outcome events in 14d, files `system_evolution_proposals(proposal_type='signal_throttle')` after 5 ignores.

**Cron:** `pg_cron` job `signals-lookahead-every-30min` calls `scheduled-routines?mode=signals_lookahead_tick` every 30 min, which forwards to `signals-synthesize?mode=lookahead_tick`.

**Frontend:** `useSignals()` hook + `<SignalSurface variant="page|indicator|inline">` component (surface-agnostic from day one — Phases C/D mount different variants without new components). `Signals` page at `/signals`, nav entry under Communications. "Handle it" navigates to `/?intent=…&signal=…` to bridge into chat orchestration.

**Voice rules in synthesis prompt:** ≤14 word headlines, no emoji, no exclamation, calm Jarvis tone. Mode-aware (focus → silence unless salience≥0.9, idle → ≤1 reflective, planning → up to 3, reactive → ≤2 directive). Lookahead prompt biases hard toward silence; only emits when commitment is drifting, prep is missing, or a wisdom-pattern leverage window opens.
