# Ozlon as a Life Operating System (EOS-style)

Goal: turn Ozlon from a set of integrations into a brain that knows your life, thinks in a consistent operating model, and pushes you forward — clarify, quantify, decide, assign, review.

## The operating model it thinks in

Borrowed from EOS, adapted for one person instead of a company:

- **Vision** — where you're going, your core values, the 1-year and 3-year picture.
- **Rocks** — 3 to 7 priorities per 90-day quarter. Everything it suggests must serve a rock or get named as a distraction.
- **Scorecard** — a handful of weekly numbers you actually watch (revenue, pipeline, hours, health, whatever you pick).
- **Issues list** — anything unresolved, worked through with Identify → Discuss → Solve. Every solved issue produces an owner and a date.
- **Weekly review** — a standing Level 10-style check: scorecard, rock status, issues solved, next week's commitments.
- **Life domains** — work, money, health, people. Each rock, issue, and number belongs to a domain so nothing quietly rots.

Every answer it gives runs through that frame. If you hand it a document, a number, or a messy situation, the default response is: what this is → what it means → the math → the recommendation → who does what by when.

## What already exists

- Memory that persists across sessions (wisdom memories, knowledge entries, reflections, artifacts ledger).
- Signals/Stack: a ranked actionable inbox with capture and urgency logic.
- People and events tables, plus a Today layer.
- A daily brief job, though it currently emits one generic sentence from an overdue-task count.
- Deep integrations: Gmail, Calendar, Drive/Docs/Sheets/Slides, ClickUp, GoHighLevel, Plaid, Slack, Search Console, research and voice.

What's missing is the connective layer: a defined life model, a context pack that reaches the chat brain on every turn, and rituals that close the loop.

## Phase 1 — The life model

New tables (all user-scoped, RLS on):

- `life_vision` — core values, 10-year target, 3-year picture, 1-year plan.
- `life_rocks` — quarter, title, domain, owner, due date, status, progress, linked goal.
- `life_scorecard_metrics` and `life_scorecard_entries` — metric definition (name, domain, unit, target, cadence) plus weekly values.
- `life_issues` — issue text, domain, priority, status, solution, resulting owner/date.
- `life_reviews` — one row per weekly review with the generated summary and commitments.

`life_goals`, `life_people`, `life_events`, and `work_tasks` already exist and get wired into this rather than duplicated.

## Phase 2 — The brain

- **Context pack**: before every chat turn, assemble a compact block — vision, active rocks with status, last scorecard row plus trend, open issues, today's calendar and stack, and relevant memories. Injected as system context so it never has to be told who you are or what matters.
- **Operating-model prompt**: the reasoning frame above, plus rules — always do the arithmetic explicitly, always tie advice to a rock or flag it as off-plan, always end with a concrete next action and a date, never dump raw JSON.
- **New tools** so it can run the model itself: read/set vision, create and update rocks, log scorecard numbers, open and solve issues, and pull a full life snapshot.
- **Analyze-anything path**: any pasted number, doc link, screenshot, or situation goes through capture → classify into a domain → analyze (with the math shown) → recommend → offer to create the task, doc, or reminder.

## Phase 3 — Rituals

- **Daily brief** upgraded: rock status, what's due, what slipped, the one thing that matters today, written in your plain-speak voice.
- **Weekly review**: a scheduled run that scores the week — metrics hit or missed, rock progress, issues opened and solved — then asks you the handful of questions it can't answer alone and stores the result as a review record.
- **Quarterly reset**: at quarter end it closes out rocks, reports the hit rate, and walks you through setting the next set.

## Phase 4 — The surface

A `/life` page, in the existing calm visual language, with:

- Vision card at the top.
- Rocks as progress rows for the current quarter.
- Scorecard as a compact weekly grid, green/red per target.
- Issues list with a solve action.
- Latest review and the daily brief.

Everything on the page is also reachable by voice or chat — the page is a mirror of what the brain already knows, not a separate app.

## Technical notes

- New tables via migration with GRANTs and `auth.uid()`-scoped RLS policies; no new client-side business logic.
- Context pack built server-side in the chat edge function and size-capped so it never crowds the tool budget.
- New chat tools registered in the existing tool registry with keyword promotion, following the current pattern.
- Weekly and quarterly rituals run as cron-invoked edge functions alongside the existing morning brief.
- Additive only: Stack, Signals, Wisdom, Communications, and all integrations stay as they are.

## Suggested order

Phase 1 and 2 together deliver most of the value — the brain becomes context-aware and starts thinking in the model. Phase 3 makes it proactive. Phase 4 gives it a face.
