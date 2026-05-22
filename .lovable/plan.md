# Project Management Skill Pack — with a learning loop

A PM brain delivered as Skills (not a new feature). It plans, prioritizes, breaks down, and assigns work — and the system already in place (`skill-observer` → `skill-reviewer` → `cross_cutting_principles`) makes it sharper every week. No new tables, no new edge functions.

## How "evolution" actually works here

You already have the loop. We just point it at PM work:

```text
        ┌──────────────────────────────────────────────────┐
        │  Every chat turn that uses a PM skill            │
        └──────────────────────────────────────────────────┘
                       │
       1. ACT          ▼
   pm-orchestrator → sub-skill runs (breakdown / prioritize / assign)
                       │
       2. RECORD       ▼
   save_memory(pattern|context|preference)  ← per-decision learning
                       │
       3. OBSERVE      ▼
   skill-observer extracts {correction, gap, workflow, simplify, meta}
   into reflection_notes  ← per-session learning
                       │
       4. CLUSTER      ▼
   skill-reviewer (weekly) clusters fresh observations into
   proposed_principles  ← cross-cutting learning
                       │
       5. APPROVE      ▼
   ProposalInbox: you accept/reject → cross_cutting_principles
                       │
       6. BIND         ▼
   Approved principle becomes a prerequisite on the relevant PM
   sub-skill (add_skill_prerequisites) OR a patch to its instructions
   (update_skill). Next run, the skill enforces it automatically.
```

Three time-scales of learning, stacked:

- **Per turn** — `save_memory` writes a `pattern` ("when user says 'plan launch' → pm-breakdown") and a `context` ("Mustajab owns frontend"). Next turn recalls it.
- **Per session** — `skill-observer` (already wired in `useConversations`) captures what went wrong, what was a gap, what you simplified.
- **Per week** — `skill-reviewer` clusters those into proposed principles. You approve. The principle is bound back into the skill so it never forgets.

That last step — **bind approved principle back into the skill** — is the "evolution" you're asking for. The skill literally rewrites its own prerequisites.

## What "see what it did wrong" looks like

The orchestrator runs a short post-action check every time:

1. Did the user immediately re-assign, re-order, or delete what was just created?
2. Did the user say "no", "wrong", "actually", "instead" in the next 2 turns?
3. Did a ClickUp task created this turn get closed within 60s (user undo)?

Any "yes" → write a `reflection_note` with `metadata.kind = 'correction'` and `importance: 0.9`. The reviewer prioritizes high-importance corrections. You see them in the Proposal Inbox with the original action AND the correction quoted side-by-side. One click to bind the lesson.

This is the closest thing to "self-aware of mistakes" we can ship without inventing new infra — it reuses the Skill Loop Phase 3 pipeline already documented in `mem://architecture/skill-loop`.

## Pack contents

Five `.skill.json` files under `public/sample-skills/`, same shape as `marketing-orchestrator`:

```text
pm-orchestrator.skill.json    front door, routes + records corrections
pm-prioritize.skill.json      RICE / Eisenhower / MoSCoW / WSJF, picks by context
pm-breakdown.skill.json       adaptive WBS (flat → epics → year-scale batches)
pm-assign.skill.json          owner match from saved team/stack context memory
pm-roadmap.skill.json         multi-week sequencing, critical-path links
```

Each one:
- Calls `search_wisdom_memories` first (recall before acting).
- Does the work using existing ClickUp + work-task tools — no new tools required.
- Calls `save_memory` after with the decision + reasoning.
- Runs the post-action "did I just get corrected?" check.

## Universal PM knowledge baked into the skills

Not generic theory — the rules the AI actually consults:

- **Prioritization** — RICE formula, Eisenhower quadrant, MoSCoW, WSJF, plus "when to pick which".
- **Breakdown** — WBS, INVEST stories, vertical slicing, definition of done, S/M/L/XL sizing, max-5-subtasks rule.
- **Sequencing** — critical path, parallel vs serial, buffer days, Friday-no-deploy default.
- **Assignment** — skill match > availability > seniority, never overload one person.
- **Hygiene** — every task has owner + due date + acceptance criteria.

Each rule is overridable by a learned principle. Your corrections always win over the textbook.

## Scalability — what "scalable" means concretely

| Pressure | How it stays scalable |
|---|---|
| 500+ tasks created in one ask (year planning) | Existing 4-wide concurrency + rate-limit retry in the chat loop. Already shipped last turn. |
| Memory grows unbounded | `wisdom_memories` dedup + recurrence_count is already in place. Low-salience patterns decay. |
| Skill count grows (5 → 50) | Compact 1-line index in `registry.ts` keeps prompt cost flat. Full instructions loaded only on `load_skill`. |
| Conflicting learned principles | `proposed_principles.status='superseded'` already supported. Reviewer replaces, doesn't append. |
| Different projects need different rules | Each principle/memory is `user_id` scoped via RLS. Multi-project = multi-context memory keys (`pm.<project>.context`). |

No table changes. No new functions. The architecture already handles the load.

## Migration — three small steps, each shippable

1. **Author the 5 skills.** Write `.skill.json` files under `public/sample-skills/`. Each declares only existing tools. Reusable from the Skills page like the marketing pack.
2. **Wire the correction detector.** Add a 30-line helper in the orchestrator's instructions that calls `save_memory` with `memory_type='correction'` whenever the next user turn matches the undo patterns. No code change — it's instructions inside the skill.
3. **Add one section to `mem://index.md`** pointing at the pack and the loop, so future agents know to use it.

## Out of scope (so this stays focused)

- No new tables, no new edge functions, no migrations.
- No UI changes — Skills page already lists/installs/toggles.
- No changes to the chat tool loop (the rate-limit fix from last turn is enough).
- No team-management table — team facts live in `context` memory until you outgrow it. Clean phase 2 if you ever do.

## What you actually get when this ships

- Ask "what should I work on?" → ranked list with a one-line "why" per item, framework picked from your saved preference.
- Ask "plan launching X over Q3" → epic + tasks + subtasks + dependencies, dripped into ClickUp safely.
- Correct it once → it never makes that same mistake again, and the lesson is visible in your Proposal Inbox.
- After ~2 weeks of use, the PM sub-skills carry *your* operating rules, not generic ones.

## Open choice for you

Say which and I'll build it:

1. **Drop-in JSON** — five files, you import from Skills page. Reversible, lowest risk.
2. **Auto-install** — same files plus a seed row so they're active immediately for your account.

Say **"1"**, **"2"**, or **"go"** (defaults to 1).
