---
name: Signals — wisdom-fused awareness layer
description: /signals route surfacing 0–3 distilled "moments" via gauntlet-router (provider=openai), with read/write fusion into the Wisdom Engine
type: feature
---
**Architecture:** Signals is the surfacing layer of the Wisdom Engine, not a parallel system.

**Tables:** `signal_moments` (with embedding for dedup), `user_context_state` (mode + quiet hours).

**Edge functions:**
- `signals-synthesize` — three modes via `?mode=`:
  - default (`now`) — real-time pass. Embeds context, recalls `match_wisdom_memories` + `match_reflections(note_type='signal_feedback')` + `wisdom_memories(memory_type='signal_tuning')` (Phase E learned floors), calls `gauntlet-router` (`node_type=signals-synthesize`, `cost_sensitivity=low` → OpenAI), uses `emit_moments` tool, dedups via `match_signal_moments` (>0.88), enforces `wisdom_memories.memory_type='signal_throttle'` caps AND learned per-kind salience floors. 0–3 moments — silence is correct default.
  - `lookahead` (per-user, JWT) — Phase B anticipation pass. Pulls Google Calendar events 24h–7d ahead via `getGoogleAccessToken` + tasks with `due_at` in window, asks GPT for ≤2 `risk`/`opportunity` moments only. Skips `focus` mode and quiet hours.
  - `lookahead_tick` (cron, gated by `x-cron-key`/`SIGNALS_CRON_KEY` env, defaults to service role) — fans out lookahead to up to 50 users active in last 7d.
- `signals-feedback` — on act/ignore/dismiss: updates lifecycle, writes `reflection_notes(note_type='signal_feedback')`, promotes to `wisdom_memories(memory_type='signal_pattern')` after 3 same-kind+outcome events in 14d, files `system_evolution_proposals(proposal_type='signal_throttle')` after 5 ignores.
- `signals-tune` (Phase E) — outcome-driven tuning. `?mode=tick` (cron-gated, fans to 100 users active in last 7d) or per-user (Bearer JWT). For each user: aggregates last 14d of `signal_moments` by `kind` → derives a per-kind `salience_floor` (ignored>70% → 0.85, acted>50% → 0.45, baseline 0.6, min sample 4), upserts a single `wisdom_memories(memory_type='signal_tuning')` row containing the JSON map. Also runs a decay pass: live signals older than 2h have salience × 0.7; below 0.25 → expired.

**Cron:** `pg_cron` jobs:
- `signals-lookahead-every-30min` — calls `scheduled-routines?mode=signals_lookahead_tick` every 30 min → forwards to `signals-synthesize?mode=lookahead_tick`.
- `signals-tune-hourly` — calls `scheduled-routines?mode=signals_tune_tick` at minute 7 each hour → forwards to `signals-tune?mode=tick`.

**Frontend:** `useSignals()` hook + `<SignalSurface variant="page|indicator|inline|voice">` component (surface-agnostic). `Signals` page at `/signals`, nav entry under Communications. **Phase C:** `variant="indicator"` (breathing dot + count + hover preview, links to `/signals`) is mounted in the global header in `Index.tsx` next to `UserMenu` for authenticated users; `variant="voice"` is mounted invisibly inside `RealtimeVoiceChat` and injects the top moment (salience ≥ 0.6, once per id) into the live OpenAI Realtime session via `sendTextMessage` framed as `[Signals layer]:` system context so the assistant can choose to relay it calmly. `variant="inline"` chip available for chat composer. **Phase D:** `Index.tsx` reads `?intent=&signal=` deep links to auto-send the suggested action into chat (bridging awareness → execution). `useContextMode` hook (mounted in `Index`) heuristically infers `focus|idle|planning|reactive` from streaming state, input activity, route, and tab visibility, upserting `user_context_state` every ≥30s — feeding mode-awareness back to `signals-synthesize`.

**Voice rules in synthesis prompt:** ≤14 word headlines, no emoji, no exclamation, calm Jarvis tone. Mode-aware (focus → silence unless salience≥0.9, idle → ≤1 reflective, planning → up to 3, reactive → ≤2 directive). Lookahead prompt biases hard toward silence; only emits when commitment is drifting, prep is missing, or a wisdom-pattern leverage window opens.
