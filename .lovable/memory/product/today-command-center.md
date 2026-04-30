---
name: Today command center
description: Calm chief-of-staff briefing layered into /signals — Now Line + Status Strip + Top of Mind + 8 cards
type: feature
---
The /signals page is wrapped by 5 intelligence layers, all additive (capture composer, captures list, daily digest, SignalSurface, FloatingCapture all still render below):

1. **Now Line** (TodayHero) — orb + one short sentence. Source: `now_line_state` + `brief.now_line`.
2. **Status Strip** — `Morning · 8:42 AM · Steady day`. Capacity is a heuristic (calendar+overdue+signals load), label only — no health data yet.
3. **Top of Mind** (TopOfMindCard) — single hero card with headline, why_now, est_minutes, signal_strength, Do it now / Snooze 1h / Why this?
4. **Command Center** — 8 calm cards: Today's Plan · Late · Up Next · People Waiting · Habits · Goals · Watch · Won Today. Each has status dot, value, one AI interpretation line, one inline action, "Why this?", and a detail bottom sheet.
5. **Why this? sheets** — 5 plain lines: trigger, connection, matters_now, if_ignored, fastest_next.

**Edge function**: `signals-brief` runs gpt-5.4 (gemini-2.5-flash via Lovable AI gateway) with strict JSON tool-calling, returns `{now_line, capacity_label, top_of_mind, cards}`. Cached on `now_line_state.metadata.brief`. Stale after 15 min.

**New table**: `life_goals` (title, why, target_date, progress 0-1, status, last_touched_at) with own-row RLS. The "+" capture router (`signals-capture`) learns the `goal` kind.

**Visual rules**: empty cards say "Clear" in muted gray (never "0"); only critical strength pulses; tap → bottom sheet, never a page jump. "Do it now" is context-aware per card (deep-links to `/?intent=...` for chat handoff).
