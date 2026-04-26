# Signals — Phase A (Substrate)

A wisdom-fused, orchestrator-driven, surface-agnostic awareness layer. Phase A locks in the architecture so Phases B–D become additions, not rewrites.

---

## 1. Database (one migration)

**`signal_moments`** — distilled "moments" the user may want to know about.
- `id, user_id, created_at, expires_at`
- `kind` (text — free-form, e.g. `commitment_due`, `inbox_pressure`, `pattern_break`, `opportunity`, `risk`)
- `headline` (≤120 chars), `reason` (≤280 chars), `suggested_direction` (text, optional)
- `salience` (float 0–1), `confidence` (float 0–1)
- `mode_context` (text: `focus|idle|planning|reactive|any`)
- `source_refs` (jsonb — array of `{type, id}` pointing to work_tasks / messages / wisdom_memories / etc.)
- `wisdom_memory_ids` (jsonb — memories that informed the synthesis, for traceability)
- `embedding` vector(1536) — for dedup + outcome attribution
- `status` (text: `live|acted|ignored|dismissed|expired|superseded`)
- `acted_at, ignored_at, dismissed_at, outcome_note` (nullable)
- RLS: user owns rows; service role full access.
- Index: `(user_id, status, salience desc, created_at desc)`.

**`user_context_state`** — lightweight current-mode store (one row per user, upserted).
- `user_id (pk), current_mode, cognitive_load_estimate, last_interaction_at, quiet_hours_json, updated_at`
- RLS: user-owned.

**Reuse existing**: `wisdom_memories`, `reflection_notes`, `system_evolution_proposals`, `work_tasks`, `communications_messages`. No new wisdom tables needed.

---

## 2. Orchestrator-driven synthesis (edge function)

**`signals-synthesize`** — single entry point, callable on-demand or by cron.

Flow:
1. Load `user_context_state` (mode, load, quiet hours). If `quiet_hours` active and not critical → exit.
2. Build a **context embedding** from: last 24h activity summary + open commitments + time-of-day.
3. **Wisdom recall (read path):**
   - `match_wisdom_memories(context_embedding, top 8)` — prior beliefs about the user.
   - `match_reflections(context_embedding, top 5, note_type='signal_feedback')` — what they've ignored/acted on before.
4. **Orchestrator-driven source discovery** — call `gauntlet-router` with `provider: "openai"` (per your requirement, GPT not Lovable AI default), passing the existing tool registry. Prompt asks GPT: *"Given these prior beliefs and current context, fetch whatever you need to answer 'what matters right now?' Return 0–3 candidate moments."* GPT chooses tools (Gmail, Calendar, work_tasks query, finance, GHL, etc.) — no hardcoded queries.
5. **Synthesis pass (also via gauntlet-router → openai):** distill candidates into final 0–3 `signal_moments` with `headline / reason / suggested_direction / salience / mode_context`, attaching `wisdom_memory_ids` used.
6. **Dedup:** before insert, cosine-compare embedding vs live signals from last 48h; skip if similarity > 0.88; supersede older ones with lower salience.
7. **Per-kind throttling:** read user's wisdom memories of `memory_type = 'signal_throttle'` for caps (e.g. "max 1 finance/day"); enforce.
8. Insert surviving moments.

**Trigger paths:**
- Manual: invoked by `useSignals` hook on page focus / surface mount.
- Scheduled: hooked into existing `scheduled-routines` (no new cron infra) — every ~15 min, gated by `user_context_state.last_interaction_at`.

**`signals-feedback`** — write path into the Wisdom Engine.
- Called when user acts/ignores/dismisses a moment.
- Updates `signal_moments.status`.
- Writes a `reflection_notes` row with `note_type='signal_feedback'`, embedding the headline + outcome.
- Recurrence promotion: if ≥3 same-kind+same-outcome reflections in 14 days → insert/update a `wisdom_memories` row with `memory_type='signal_pattern'` (existing recurrence machinery in the Wisdom Engine handles the rest).
- Meta-pattern: if a pattern would change *system behavior* (e.g. suppress a kind), write a `system_evolution_proposals` row instead of mutating directly.

Both functions deploy with default `verify_jwt = false` and validate JWT in code.

---

## 3. Frontend — surface-agnostic from day one

**`src/hooks/useSignals.ts`** — single hook, all surfaces consume it.
- Subscribes to `signal_moments` via Supabase realtime (`status='live'`, ordered by salience).
- Exposes: `moments, topMoment, mode, act(id), ignore(id), dismiss(id), askWhy(id), askWhat(id), refresh()`.
- `act()` navigates to `/?session=new&intent=<encoded suggested_direction>` — bridges to existing chat/orchestration.
- `askWhy/askWhat` open inline expansions (no nav).

**`src/components/signals/SignalSurface.tsx`** — one component, multiple variants.
- Props: `variant: "page" | "indicator" | "inline" | "voice"`, `maxMoments?`, `autoExpand?`.
- `page`: full minimalist single-moment view with breathing dot, large type, inline `Why? / What should I do? / Handle it / Not now` text triggers (no buttons, per spec).
- `indicator`: small breathing dot in top-right nav with hover/tap preview of `topMoment`. Silent when none.
- `inline`: chip embeddable in chat composer / other surfaces.
- `voice`: returns `{ utterance, shouldSpeak }` for the realtime voice mode to consume.

This single decision satisfies your Phase D ("lives everywhere") with no future migration.

**`src/pages/Signals.tsx`** — thin route wrapper rendering `<SignalSurface variant="page" />`. Apple Vision Pro minimalism, generous spacing, no chrome.

**Navigation:**
- Add **Signals** entry to `src/components/UserMenu.tsx` directly under Communications (link to `/signals`, `Activity` icon).
- Register `/signals` route in `src/App.tsx`.

---

## 4. Mode detection (lightweight)

A small client-side helper updates `user_context_state` from passive signals — no new infra:
- typing cadence in chat composer → `reactive` if recent burst
- idle > 10 min → `idle`
- calendar event "focus"/"DND" via existing google-calendar tool → `focus`
- otherwise → `planning` (default mid-day) or `idle`

Synthesis prompt and surfacing rate both key off this column.

---

## 5. Files

**New:**
- `supabase/migrations/<ts>_signal_moments_and_context.sql`
- `supabase/functions/signals-synthesize/index.ts`
- `supabase/functions/signals-feedback/index.ts`
- `src/pages/Signals.tsx`
- `src/hooks/useSignals.ts`
- `src/hooks/useUserContextMode.ts`
- `src/components/signals/SignalSurface.tsx`

**Modified (additive only — per stabilization policy):**
- `src/App.tsx` — add `/signals` route.
- `src/components/UserMenu.tsx` — add Signals item under Communications.
- `supabase/functions/scheduled-routines/index.ts` — add a `signals_synthesize` tick.

**Memory updates after build:**
- `mem://features/signals-awareness-layer` — full feature spec.
- `mem://architecture/signals-wisdom-fusion` — read/write integration with Wisdom Engine.
- Append Core line to `mem://index.md`: "Signals = surfacing layer of the Wisdom Engine. Routes via gauntlet-router with provider=openai. Surface-agnostic via `<SignalSurface variant>`."

---

## 6. Evolution roadmap (locked in by this substrate)

- **Phase B — Anticipation:** scheduled deeper synthesis pass that runs `match_wisdom_memories` on *future* commitments (calendar lookahead, due-date drift) → emit `risk` / `opportunity` kinds. No schema change.
- **Phase C — Presence:** mount `<SignalSurface variant="indicator" />` in the global header; wire `variant="voice"` into `useRealtimeVoice`. No new components.
- **Phase D — Invisibility:** mount `variant="inline"` inside chat composer + relevant pages. Tune throttling memories so volume drops as confidence rises. Pure config.

---

## 7. What this delivers vs your spec

- ✅ Always aware, only surfaces when meaningful (salience + dedup + throttling).
- ✅ No buttons / no rigid flows — text-only triggers in `variant="page"`.
- ✅ Moments not lists — synthesis caps at 3, page shows 1 at a time.
- ✅ Anticipation-ready — embedding + wisdom recall is the foundation.
- ✅ Memory + context fusion — wisdom memories are inputs *and* outputs.
- ✅ Learning model — every action writes a reflection, recurrence promotes to memory, meta-patterns become proposals (not unilateral changes).
- ✅ Destination invisible — orchestrator handles execution, Signals only shows intent + outcome.
- ✅ Routes via OpenAI explicitly via `gauntlet-router` with `provider: "openai"`.

Approve to implement Phase A.