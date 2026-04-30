# Your Today — A Calm Chief of Staff (5 Intelligence Layers)

This evolves the existing Today surface into a quiet briefing that **observes → interprets → prioritizes → recommends one move at a time**. No dashboard feel, no robotic tone, no extra noise. Every card earns its place by saying something a human chief of staff would say.

The Now Line stays the heartbeat. Everything else supports it.

## The 5 layers, top to bottom

```text
┌────────────────────────────────────────────────────────┐
│                 ●  (breathing orb)                      │
│                                                         │
│   "You have 3 things before lunch.                     │  ← Layer 1: Now Line
│    Sarah's birthday is tomorrow."                      │
│                                                         │
│   Morning · 8:42 AM · Steady day                       │  ← Layer 2: Status Strip
└────────────────────────────────────────────────────────┘
┌──────────── Top of Mind ─────────────────  ●  high  ──┐
│                                                         │
│   Reply to Jamie before noon.                          │  ← Layer 3: Top of Mind
│   Open opportunity. Two days waiting. ~6 minutes.      │
│                                                         │
│   [ Do it now ]   Snooze 1h   Why this?                │
└────────────────────────────────────────────────────────┘
┌── Today's Plan ──┬── Late ──────┬── Up Next ──────────┐
│ 4 to do · 60%    │ 2 need you   │ Standup 9:30        │  ← Layer 4: Situational
│ Two quick wins.  │ One blocks   │ 18 min — review     │
│ One needs focus. │ the launch.  │ yesterday's notes.  │
│ [ Start first ]  │ [ Clear it ] │ [ Prepare ]         │
├── People Waiting ┼── Habits ────┼── Goals ────────────┤
│ 3 follow-ups     │ Walk · Read  │ Q4 Launch · 78%     │  ← Layer 5: Strategic
│ Jamie is most    │ Walk is your │ Today's page task   │
│ time-sensitive.  │ easiest win. │ moves this forward. │
│ [ Draft reply ]  │ [ Start ]    │ [ Next step ]       │
├── Watch ─────────┴──────────────┼── Won Today ────────┤
│ 1 deal stalled 5 days           │ 6 done · 2h focus   │
│ Follow up today keeps it warm.  │ Ahead on admin.     │
│ [ Create follow-up ]            │ [ Review wins ]     │
└─────────────────────────────────┴─────────────────────┘
```

Tap any card → calm bottom sheet with the full list + AI commentary + actions. Never a page jump.

---

## Layer 1 · Now Line (kept as-is)

The orb + one-sentence narration already shipped. We **don't touch it**. The new edge function regenerates it so it introduces the Top-of-Mind move ("You have 3 things before lunch. Sarah's birthday is tomorrow.").

## Layer 2 · Status Strip (new, tiny)

A single muted line under the Now Line:

```
Morning · 8:42 AM · Steady day
```

Three words, computed locally:
- **Mode**: `Morning` (before 12), `Midday` (12–17), `Evening` (after 17).
- **Time**: short clock.
- **Capacity** (not "energy"): one of `Light day`, `Steady day`, `Heavy day`, `Overloaded day`. Computed from calendar density + overdue + high-strength signals + open loops. Pure heuristic until health data lands.

No icons. No bars. No tooltips. The capacity label quietly informs the brief's tone and ordering — it doesn't get explained in the UI.

## Layer 3 · Top of Mind (the hero card)

The single most important card on the page. Always rendered unless the day is genuinely clear.

Contents:
- **Headline** — what to do, plain.
- **Why now** — one sentence ("Open opportunity. Two days waiting.")
- **Time** — `~6 minutes`
- **Signal strength dot** — `low | medium | high | critical` (only High/Critical pulse subtly)
- **Actions** — `Do it now` (primary), `Snooze 1h`, `Why this?`

If the day is clear:
> "You're clear right now. Best move: 45 minutes of deep work on Q4 Launch."
> [ Start focus block ]   Why this?

## Layer 4 · Situational Awareness (5 small cards)

Today's Plan · Late · Up Next · People Waiting · Habits

Each card carries:
- status dot (signal strength)
- plain label (no jargon)
- short value or tiny progress bar
- **one AI interpretation line** (this is the difference between data and intelligence)
- one inline action
- `Why this?` affordance

Empty cards render `Clear` in muted gray, not `0`, not hidden — the calm of a clear column matters.

## Layer 5 · Strategic Awareness (3 cards)

Goals · Watch · Won Today

These connect today to the bigger picture. The AI line on each is the whole point:
- Goals → "Today's landing page task moves this forward."
- Watch → "Follow up today keeps it warm."
- Won Today → "Ahead on admin. Shift to deep work."

## Action Layer (context-aware "Do it now")

`Do it now` does the *right thing* per card type:

| Card | Do it now → |
|---|---|
| Top of Mind | runs the `do_now_intent` in chat |
| Today's Plan | starts a focus block on the first task |
| Late | opens or reschedules the most urgent overdue |
| Up Next | opens prep notes for the next event |
| People Waiting | drafts a reply to the highest-priority person |
| Habits | starts/checks-in the easiest habit |
| Goals | opens the goal's next concrete step |
| Watch | creates a recovery action |
| Won Today | opens a brief reflection sheet |

Every card also exposes secondary actions in its detail sheet (Snooze, Reschedule, Mark clear, Ask AI, Create next action).

## Why this? — explainable everywhere

A bottom sheet that, in plain speech, lays out:
- the trigger ("Jamie has been waiting 2 days")
- the connection ("tied to your Ozlon revenue goal")
- why it matters now ("48-hour follow-ups convert better for you")
- what happens if ignored ("the deal trends cold")
- the fastest next action ("a six-minute reply")

The brief includes these per recommendation so the sheet is instant — no second AI call.

## Daily Arc (morning / midday / evening)

The same eight cards stay; the **AI commentary, ordering, and primary action adapt**.

- **Morning** — emphasize planning, prep, priorities, risk prevention. Top of Mind tends toward "start with X."
- **Midday** — emphasize progress, adjustments, overdue, next move. Top of Mind tends toward "one follow-up still matters before 3 PM."
- **Evening** — emphasize wins, misses, tomorrow setup. Top of Mind tends toward "set tomorrow's first move."

The mode is read from local time and passed into the brief's prompt.

## Signal Strength (calm, not loud)

`low | medium | high | critical`. Visual emphasis is reserved:
- low/medium → muted dot
- high → solid foreground dot
- critical → solid dot + the *only* subtle pulse on the page

At most one card at a time may breathe. The Top of Mind card breathes only when it's High or Critical.

---

## Files we'll add

- `src/components/today/StatusStrip.tsx` — mode · time · capacity
- `src/components/today/TopOfMindCard.tsx` — hero recommendation card
- `src/components/today/CommandCenter.tsx` — grid container for the 8 small cards
- `src/components/today/CardShell.tsx` — shared shell (status dot, label, value, AI line, action, Why this)
- `src/components/today/CardDetailSheet.tsx` — bottom sheet (full list, commentary, actions)
- `src/components/today/WhyThisSheet.tsx` — explainability sheet
- `src/components/today/cards/PlanCard.tsx`
- `src/components/today/cards/LateCard.tsx`
- `src/components/today/cards/UpNextCard.tsx`
- `src/components/today/cards/PeopleWaitingCard.tsx`
- `src/components/today/cards/HabitsCard.tsx`
- `src/components/today/cards/GoalsCard.tsx`
- `src/components/today/cards/WatchCard.tsx`
- `src/components/today/cards/WonTodayCard.tsx`
- `src/hooks/useDailyBriefing.ts` — hydrates capacity + brief + all eight card payloads in parallel
- `src/lib/today/capacity.ts` — pure helper that scores capacity from calendar/overdue/loops
- `src/lib/today/dayMode.ts` — morning/midday/evening from local time
- `supabase/functions/signals-brief/index.ts` — produces the brief (Now Line refresh, Top of Mind, per-card AI lines, Why-this payloads)
- `supabase/migrations/<ts>_life_goals.sql` — adds `life_goals` table + RLS

## Files we'll edit (surgically, additive)

- `src/components/today/TodayHero.tsx` — render `<StatusStrip />` directly under the now-line; remove the existing "also coming up" dots **only because they now live in Up Next**.
- `src/pages/Signals.tsx` — render `<TopOfMindCard />` then `<CommandCenter />` between the hero and the existing capture composer. Composer, "Your captures," daily digest, `<SignalSurface />`, `<FloatingCapture />` all stay below.
- `src/hooks/useTodayLayer.ts` — extend with goals + brief; existing consumers untouched.

## Database (one new table)

```sql
create table public.life_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  why text,
  target_date date,
  progress numeric not null default 0,    -- 0..1
  status text not null default 'active',  -- active | paused | done
  last_touched_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.life_goals enable row level security;
-- own-row select/insert/update/delete policies
```

`signals-capture` (the "+" router) learns one new kind: `goal`.

## The new edge function: `signals-brief`

Single call returns one structured payload that powers every card. Runs on load, on demand, and every 30 min via cache.

Pulls in parallel: today's `life_events`, overdue events, next 4 calendar events, top Stack items, `life_people` overdue for follow-up, `life_goals` (touched/neglected), risk-tagged signals, GHL pipeline drift, recent `wisdom_memories` + `cross_cutting_principles`, day mode, capacity score.

Sends to **gpt-5.4** with a strict JSON schema:

```jsonc
{
  "now_line": "string (≤ 14 words)",
  "capacity_label": "Light day | Steady day | Heavy day | Overloaded day",
  "top_of_mind": {
    "headline": "string",
    "why_now": "string",
    "est_minutes": 6,
    "signal_strength": "low | medium | high | critical",
    "do_now_intent": "string (chat prompt)",
    "why_this": { "trigger": "...", "connection": "...", "matters_now": "...", "if_ignored": "...", "fastest_next": "..." }
  },
  "cards": {
    "plan":         { "value": "4 to do · 60%", "ai_line": "...", "action": "...", "signal_strength": "...", "why_this": {...} },
    "late":         { ... },
    "up_next":      { ... },
    "people":       { ... },
    "habits":       { ... },
    "goals":        { ... },
    "watch":        { ... },
    "won_today":    { ... }
  }
}
```

Result cached on `now_line_state.metadata.brief`. Now Line is rewritten in the same response so the orb and the Top of Mind card always agree.

## Wisdom Engine integration (the "personal" part)

The brief prompt receives the user's top-relevant `wisdom_memories` and `cross_cutting_principles`, so the *why_now* and *why_this* lines sound like the user's own values:

- Generic: "It's been two days."
- Personalized: "You said two-day silence costs trust. Reply now."

Used invisibly. The user only sees the calm sentence.

## Visual + voice rules (enforced everywhere)

- Vision Pro calm aesthetic. Soft glass, subtle depth, rounded corners, generous spacing.
- No emojis. No icons screaming for attention. No exclamation marks.
- Plain-speak: ≤ 14 words per sentence; "you"; relative time ("in 18 minutes"); never "task," "ticket," "blocker."
- Empty cards say `Clear` in muted gray.
- At most one element pulses on the page at a time.
- Tap → bottom sheet, never a page jump.

## What stays (additive constraint)

- Unified chat home `/` untouched.
- `/signals` keeps capture composer, "Your captures," daily digest, `SignalSurface`, `FloatingCapture` — all rendered **below** the Command Center.
- All existing memories and constraints honored.

## Out of scope (deliberate)

- Real health/biological energy data (Stage 3, later).
- Push notifications.
- Drag-to-reorder cards (fixed opinionated order ships first).
- Per-card hide/show settings.

## Acceptance criteria

1. Hero: orb + Now Line + Status Strip (`Morning · 8:42 AM · Steady day`) at the top.
2. Top of Mind card directly below: headline, why-now, est time, signal-strength dot, `Do it now` + `Snooze 1h` + `Why this?`.
3. Eight command cards in a calm grid, each with status dot, value, **one AI interpretation line**, one inline action, `Why this?`.
4. Empty cards show `Clear` in muted gray.
5. Tapping any card opens a bottom sheet with the full list and actions — no navigation.
6. `Do it now` is context-aware per card type (table above).
7. Card commentary, ordering, and primary action shift between Morning / Midday / Evening modes.
8. Only the active priority subtly pulses; everything else is calm.
9. Composer, captures, digest, SignalSurface, FloatingCapture still render below the Command Center.
10. The page feels like a calm chief-of-staff briefing — not a dashboard.

Approve and I'll build it in one pass.
