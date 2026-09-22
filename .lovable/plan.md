# Executive assistant that thinks in outcomes

Today when you say "I want to start a cleaning company", Ozlon writes a task with description text. It never says what finished looks like, what the steps between here and there are, or who does what next. This changes that.

## What changes for you

**1. Every task starts as an outcome, not a description**

When you ask for something to be created, Ozlon first answers four things in plain language:

- What you're actually trying to get to
- What "done" looks like, in things you can point at (a live website, a signed cleaner contract, a booking pipeline that runs without you)
- The steps from A to B, in order, each one a real piece of work
- The first move: what happens next, who does it, by when

It asks at most one question if something important is missing. Then it shows you the outcome and asks to send it over.

**2. It knows which business you're talking about**

You'll have a short list of your businesses — the cleaning company, Avalon, anything you add. Each one holds its own stage, what's already built, who works in it, and where its work lives in ClickUp. So "we need cleaners" lands in the cleaning company with the contract and hiring context already attached, and Avalon work never gets mixed in.

**3. It lands in your project management clean**

Sending an outcome to ClickUp creates one parent task written for a human:

```text
Success looks like
 - ...
Done when
 - ...
Steps
 1. ...
```

Each step becomes a subtask with its own due date and priority. No raw data dumps, no machine text.

**4. It pushes, it doesn't just record**

- A daily check reads what moved and what didn't, and tells you the one thing to do next per business.
- Anything stalled past its date becomes a nudge in your Today view.
- Ozlon can leave instructions as a comment on a task for whoever owns it, so a worker (or another assistant reading that board) gets the context without you retyping it.

**5. A place to see it**

Life OS gains a Businesses view: each business, its live outcomes, how far each one is, and what's stuck.

## Build order

1. Businesses and outcomes stored in the backend, with the cleaning company and Avalon seeded from what you tell me.
2. The outcome thinking built into how Ozlon answers and creates work.
3. Clean delivery into ClickUp: parent task, readable description, subtasks with dates.
4. Daily push: progress read, next-move suggestion, stalled nudges into Today.
5. Life OS Businesses view.

## Technical notes

- New tables `ventures` and `outcome_specs` (+ `outcome_steps`), RLS scoped to `auth.uid()`, GRANTs for `authenticated` and `service_role`. `outcome_specs` holds goal, success criteria, definition of done, ordered steps, venture_id, clickup parent task id, status.
- `supabase/functions/_shared/outcomes.ts`: `OUTCOME_FRAME` prompt block (extends `LIFE_OS_FRAME`) plus tools `draft_outcome`, `save_outcome`, `deliver_outcome` (ClickUp parent + subtasks via the existing clickup manifest, description rendered as markdown by a formatter, never JSON), `list_ventures`, `set_venture_context`, `comment_on_task`.
- Wire into `chat/index.ts`: register with `LIFE_TOOLS` in the tool list, add tool names to `CORE_TOOLS` so they survive tool-budget pruning, inject `OUTCOME_FRAME` + active venture line into `buildSystemPrompt`, and add a hard rule: no `create_clickup_task` for a goal-shaped ask until an outcome exists.
- Daily push reuses the existing `background_jobs` / `jobs-worker` + cron pattern: read outcome step status from ClickUp, write watchouts through the existing signals path so they appear in `DayColumns`.
- `src/pages/Life.tsx` gains a Businesses section reading `ventures` + `outcome_specs` with inline progress; no redesign of existing sections.
