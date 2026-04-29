## The Stack — one true source for everything that needs you

Today the product has **three parallel "to-do-ish" surfaces** that don't talk:

1. `/signals` — AI-surfaced moments (`signal_moments`)
2. `/communications` Focus stack — message-derived priorities (`PriorityItem`, ephemeral)
3. User captures — typed into the Signals composer, also `signal_moments`

Plus four more *implicit* sources that already exist and have nowhere to land: voice "remind me…", agent-proposed follow-ups (`signals-synthesize`), wisdom-engine evolution proposals, and stalled chat task activity (`useTaskActivityStore`).

The result is fragmentation: nothing feels canonical, nothing checks off.

**The Stack** unifies all of them into one calm, checkable, scheduling-aware, agent-aware surface — the single answer to *"what needs me right now?"*

---

## Mental model

```text
         INPUT CHANNELS (already exist)              ONE SURFACE                OUTPUTS
   ┌─────────────────────────────────────┐           ┌─────────┐           ┌──────────────────┐
   │ AI signals (digest, urgent)         │           │         │           │ Agent execution  │
   │ Email/Slack/SMS triage              │           │         │           │ Drafted replies  │
   │ User captures (text + voice)        │  ───►     │  STACK  │  ───►     │ Calendar holds   │
   │ Agent-proposed follow-ups           │           │         │           │ Snooze / done    │
   │ Wisdom evolution proposals          │           │         │           │ Briefing read-out │
   │ Stalled chat task activities        │           └─────────┘           └──────────────────┘
   └─────────────────────────────────────┘
                                              ▲
                                              │
                                       Realtime + cron
```

Every row is a **StackItem** — a normalized projection. No new entity. `signal_moments` stays the canonical store.

```ts
StackItem {
  id;                                  // synthetic: `${source}:${sourceId}`
  source: 'signal' | 'comm' | 'capture' | 'voice' | 'agent' | 'wisdom' | 'task';
  sourceId;
  headline; subline?; who?; channel?;
  urgency: 'high' | 'medium' | 'low';   // f(salience, dueAt, mode)
  status: 'open' | 'snoozed' | 'done' | 'dismissed';
  dueAt?; snoozedUntil?; completedAt?;
  agentSuggestion?: { skillSlug; label; autoIntent; estSeconds };
  primaryAction: { kind; payload };     // 'reply' | 'run_skill' | 'open_link' | 'mark_done'
  origin: { route; deepLink };          // tap-through to source context
  signalRefs: string[];                 // for dedupe collapsing
}
```

---

## The five ranking signals (urgency engine)

This is what makes The Stack feel like a real PA, not a list. Every item gets a score `0..1`:

```
score = 0.35·salience
      + 0.20·timeProximity(dueAt)        // closer due → higher
      + 0.15·sourceWeight(source)        // signal>comm>capture>wisdom
      + 0.15·whoWeight(who)              // VIP from wisdom_memories
      + 0.10·modeFit(currentMode)        // focus mode dampens low-urgency
      + 0.05·streak(recurrence_count)    // repeated nags get heavier
```

- `whoWeight` reuses the existing `wisdom_memories` for "important people" memory.
- `modeFit` reads `useCurrentMode()` — in `focus`, anything below 0.6 collapses into "Later".
- Score → `urgency` band: ≥0.75 high, ≥0.45 medium, else low.
- Score is recomputed client-side on each render; no DB writes.

---

## Phase 1 — Unify the surface (no schema change, ship in one pass)

New `/stack` route. `/signals` and `/communications` remain (additive policy — nav links to all three).

### Behaviour
- **Checkable rows** — round checkbox left; tap = optimistic strikethrough → 400ms collapse → `respond('complete')` or `priority.markDone()` based on `source`.
- **Bulk select** — long-press / shift-click → `Complete · Snooze 1h · Snooze tomorrow · Schedule… · Dismiss`.
- **Smart auto-grouping** (collapsible, count badges):
  - `Now` — score ≥ 0.75 OR `dueAt ≤ today` (always expanded, max 5 visible — overflow = "+3 more")
  - `Soon` — score ≥ 0.45 OR `dueAt ≤ 3d`
  - `Later`
  - `Snoozed` (collapsed)
  - `Done today` (collapsed, drives the progress strip)
- **Cleared today · 3 / 7** progress strip — single thin line, no chart.
- **Undo toast** (5s, sonner) on every destructive action — writes prior status back.
- **Keyboard nav** — reuse `j/k/enter/e/s` from `Communications.tsx` (muscle memory transfers).
- **Swipe gestures** (mobile) — left = snooze 1h, right = done. Mirrors `useSwipeActions` already in repo.
- **Empty state** — "Nothing on the stack. The system will surface what matters." (Vision-Pro tone).

### Visual rules (calm, not loud)
- Single 2px left stripe per urgency: `amber-500/40` high, `primary/30` medium, none low. **Never bright fills.**
- One row template across all sources. Source shown as a muted chip (`signal`, `email`, `slack`, `capture`, `voice`, `agent`).
- Selection bar = same `bg-card/50 backdrop-blur-2xl border` as the (already calm-fixed) `SignalsBanner`.
- Strikethrough animates over 250ms before the row collapses (400ms height transition) — feels like checking off, not vanishing.

### Dedupe rules (avoid "the same thing twice")
1. A signal whose `source_refs[0].kind === 'email'` with matching `messageId` of a comm priority → collapse into the comm row; signal becomes the comm row's `agentSuggestion`.
2. Two signals with `1 - cosine(embedding) > 0.92` within 24h → keep newer, attach older to `signalRefs[]`.
3. A capture with `headline ≈ pinned comm subject` (Levenshtein < 0.2) → merge into the comm row.

Dedup runs **client-side** in `useStack` after merge — no edge function.

### New files
- `src/hooks/useStack.ts` — merges all sources, applies urgency engine + dedup, exposes `complete / snooze / dismiss / scheduleFor / pin / runAgent` and `bulk*` variants.
- `src/components/stack/StackRow.tsx`
- `src/components/stack/StackGroup.tsx`
- `src/components/stack/StackSelectionBar.tsx`
- `src/components/stack/StackProgressStrip.tsx`
- `src/components/stack/StackQuickAdd.tsx` (composer pinned to bottom)
- `src/pages/Stack.tsx`

### Light edits (no rewrites)
- `src/pages/Signals.tsx` — replace ad-hoc list rendering with `<StackRow>` (page kept; visual now matches).
- `src/components/communications/FocusStack.tsx` — extract `onDone/onSnooze` into a tiny `useCommActions()` hook so `useStack` calls the same code path (zero duplicate logic).
- `src/components/NavLink.tsx` + BottomNav — add `Stack` entry.
- `src/components/CommandPalette.tsx` — add "Open Stack" and "Capture to Stack".

---

## Phase 2 — Make items real tasks (one small migration)

```sql
ALTER TABLE public.signal_moments
  ADD COLUMN IF NOT EXISTS due_at         timestamptz,
  ADD COLUMN IF NOT EXISTS snoozed_until  timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS parent_id      uuid REFERENCES public.signal_moments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pinned_at      timestamptz;

CREATE INDEX IF NOT EXISTS idx_signal_moments_due
  ON public.signal_moments (user_id, due_at)
  WHERE status = 'live' AND due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_moments_snoozed
  ON public.signal_moments (user_id, snoozed_until)
  WHERE status IN ('live','snoozed') AND snoozed_until IS NOT NULL;

-- Daily Stack pulse (denormalized for fast briefings)
CREATE TABLE IF NOT EXISTS public.stack_daily_summary (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT current_date,
  cleared_count int NOT NULL DEFAULT 0,
  carried_over_count int NOT NULL DEFAULT 0,
  longest_carryover_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stack_daily_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self read" ON public.stack_daily_summary
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "service write" ON public.stack_daily_summary
  TO service_role USING (true) WITH CHECK (true);
```

Update `validate_signal_moment()`:
- Add `'snoozed'` to allowed statuses.
- Set `completed_at = now()` when status flips to `'acted'` (mirrors the existing `set_work_task_completed_at` pattern).
- When `status = 'snoozed'`, require `snoozed_until IS NOT NULL`.

**Why no new task entity:** there's no separate task table, no `/tasks` page, no task store. We're augmenting `signal_moments` — the table that already exists for this — with the time fields it always needed. Honours the no-Tasks-page rule because The Stack is a *view*, not a store.

---

## Phase 3 — Scale: agent-aware, time-aware, voice-aware

### 3a. Snooze + due-date cron
Extend `supabase/functions/scheduled-routines` to run every 5 min:
- Flip `status='live'` for rows where `snoozed_until <= now()` (auto-resurface).
- For rows with `due_at <= now() + 1h` and `salience < 0.85`, bump salience to 0.85 → surface to `Now`.
- Increment `recurrence_count` if a row gets re-surfaced after dismissal within 48h (the urgency engine then weights it heavier — repeated nags get noticed).
- Emit a `signal_moments` realtime update so subscribed clients re-render without polling.

### 3b. Inline agent action
`useStack` matches each item against the skill registry (the keyword-matching logic from `SignalSurface` generalized):
- Match → row shows `[Run: <skill name> · ~30s →]` chip with estimated runtime.
- Tap → routes to `/?intent=…&skill=…&signal=…&autorun=1`. Chat already supports this deep-link.
- For comm rows → chip is `[Reply with AI]` (existing `ReplySheet` flow, preserved verbatim).
- After agent completes, edge function writes `outcome_note` back to the source signal — Stack shows a thin `Done by AI · 17s` annotation under the strikethrough for 24h before the row truly disappears.

### 3c. Capture from anywhere
- `Cmd+K → "Capture"` via `CommandPalette.tsx` — global capture shortcut.
- Voice: in realtime mode, intents matching `remind me…` / `add to stack…` / `don't let me forget…` already route through `signals-create` — confirm the realtime function recognises these triggers and sets `kind='voice_capture'`.
- Brain triage in `signals-create` already classifies `signal_type` (task / message / reminder / thought) — surface that as the row's source chip.
- **Auto-extract due dates** from capture text using the existing `gpt-5-nano` path: "Reply to Jamie by Friday" → `dueAt = next Friday 17:00 local`. Show inline confirmation chip the user can tap to remove.

### 3d. Daily ritual + briefing loop
- **Morning brief** (8am local, configurable): `BriefMeOverlay` reads `useStack` items, calls `text-to-speech`, narrates "You have 7 things on the stack today. 3 are urgent…". Pre-existing `BriefMeOverlay` and TTS pipeline used as-is.
- **Evening clear** (6pm local): a single ambient line at the bottom of the stack — "5 cleared. 2 carried over. The longest waiting is X — handle now or push to tomorrow?" Tap = bulk reschedule.
- Both write into `stack_daily_summary` so the wisdom engine learns the user's clearance patterns over time.

### 3e. Wisdom feedback loop
Every `complete / dismiss / snooze` writes a tiny `reflection_notes` row (`note_type='stack_outcome'`) capturing:
- which `source` performed best (signals vs comms vs captures)
- average time-to-clear by urgency
- which `who` recurringly gets snoozed (signal of avoidance worth surfacing in coaching)

This makes the urgency engine's `whoWeight` and `sourceWeight` learnable per-user instead of hard-coded — Phase 4 picks this up.

---

## Phase 4 — Optional, only if Phase 1–3 prove out

- **Recurring** items via `metadata.rrule` (RFC 5545 subset).
- **Sub-tasks** UI using the `parent_id` column from Phase 2.
- **Calendar / week timeline view** as a `Stack` page tab.
- **Per-source filter chips** at top of `/stack`.
- **Adaptive ranking weights** — replace hard-coded urgency-engine constants with per-user weights learned from the Phase 3e reflection notes.
- **Stack-as-context** — the chat edge function already takes a `mode_context`; add a `stack_snapshot` payload so any chat reply can reference "since you have 3 urgent items, I'll keep this brief."

Each independently shippable; none required to call Phase 1–3 done.

---

## Non-functional guarantees

| Concern         | Approach                                                                                                |
|-----------------|---------------------------------------------------------------------------------------------------------|
| Performance     | Stack render is pure client merge. No new edge function in Phase 1. p50 render < 16ms for 100 items.    |
| Realtime        | Reuses existing `signal_moments` realtime channel; piggyback comm priorities via existing feed hook.    |
| Offline         | Capture queues to `localDb.ts` (IndexedDB) and flushes on reconnect — no UX change online.              |
| RLS             | All new columns sit on `signal_moments` (existing RLS already self-scoped). New table has explicit RLS. |
| Privacy         | Reflection notes use summaries only, never message bodies (matches existing wisdom-engine policy).      |
| Backwards-compat| `/signals` keeps working unchanged; `useSignals` untouched; FocusStack handlers extracted, not removed. |

---

## Why this is the right shape

- **Zero rewrite, additive only.** Reuses `signal_moments`. One small migration in Phase 2.
- **Honours the no-Tasks-page rule.** No new entity; The Stack is a *view*, not a store.
- **Comms triage logic untouched.** Priorities project read-only; pinning is the one explicit promotion.
- **Replaces three competing visual systems** with one row template + one urgency stripe + one selection bar.
- **Voice-first compatible.** Voice capture → Stack → voice briefing closes the loop without a screen.
- **Self-improving.** Phase 3e seeds the data the urgency engine needs to personalize in Phase 4.
- **Realtime + Undo + Snooze cron** are the three missing primitives that turn "list of cards" into a real inbox.

---

## Build order (each phase independently shippable)

1. **Phase 1** — `useStack` (with urgency engine + dedup), `StackRow`, `/stack` page, nav entry, retrofit `/signals` to use `StackRow`. *No backend changes.*
2. **Phase 2** — migration for `due_at / snoozed_until / completed_at / parent_id / pinned_at` + `stack_daily_summary` + trigger update + UI for Schedule/Snooze.
3. **Phase 3** — snooze cron, inline agent chip generalization, Cmd+K + voice capture, morning/evening rituals, reflection-note feedback loop.
4. **Phase 4** — only on demand.

---

## Out of scope explicitly

- Re-adding a `/tasks` route or store (forbidden).
- Removing or restyling `SignalsBanner`, `FocusStack`, or `/communications` triage logic — they continue feeding The Stack.
- Recurring tasks, sub-task UI, calendar view, adaptive weights (deferred to Phase 4).
- Any change to `signals-synthesize`, `signals-feedback`, or chat tool loop signatures.
- Mobile push notifications (separate Capacitor plumbing — Phase 4+).
