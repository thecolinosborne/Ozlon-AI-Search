---
name: PM skill pack
description: Project management orchestrator + 4 sub-skills (prioritize, breakdown, assign, roadmap). Self-improves via the existing skill-observer → skill-reviewer → cross_cutting_principles loop.
type: feature
---

The PM Pack ships 5 skills as `.skill.json` files under `public/sample-skills/`. Same shape and import flow as the Marketing Pack.

`pm-orchestrator` is the front door. Per request it:
1. Recalls past routing patterns + recent corrections via `search_wisdom_memories`.
2. Routes to one of: `pm-prioritize`, `pm-breakdown`, `pm-assign`, `pm-roadmap`.
3. Hands off via `load_skill(<slug>)`.
4. Saves a `pattern` memory after the route.
5. On the NEXT user turn runs a correction detector — if the user says "no/wrong/actually/undo" or re-does what was just created, writes a `correction` memory with salience 0.9.

Sub-skills:
- **pm-prioritize** — RICE / Eisenhower / MoSCoW / WSJF. Framework picked from saved preference or inferred from the ask. Always proposes a ranking; never silently reorders ClickUp.
- **pm-breakdown** — Adaptive WBS depth (flat / epic+tasks / calendar-batched year). Enforces INVEST, definition of done, max-5 subtasks, S/M/L/XL sizing, no Friday deploys. Tree-confirm before writing.
- **pm-assign** — Skills > availability > seniority. Anti-overload (60% cap per person). Team + stack from `context` memory; asks once if missing.
- **pm-roadmap** — Multi-week → multi-year sequencing with critical path + buffer days. Epics → tasks → dependencies. For >50 task batches, surfaces estimate + confirm before writing. Relies on the chat dispatcher's 4-wide concurrency + rate-limit retry.

Learning loop (no new infra):
- Per-turn: `save_memory(pattern|context|preference|correction)`.
- Per-session: `skill-observer` writes `reflection_notes`.
- Weekly: `skill-reviewer` clusters fresh observations into `proposed_principles`.
- On approval in ProposalInbox: bind back via `add_skill_prerequisites` or `update_skill` so the sub-skill enforces the lesson automatically.

Tools required (all already in `chat/index.ts` — no registry changes): `load_skill`, `search_wisdom_memories`, `save_memory`, `update_skill`, `add_skill_prerequisites`, `create_clickup_task`, `create_clickup_subtask`, `set_clickup_due_date`, `set_clickup_assignees`, `set_clickup_priority`, `add_clickup_dependency`, `search_clickup_tasks`, `list_clickup_tasks`, `list_clickup_members`, `list_clickup_lists`, `create_clickup_checklist`, `create_clickup_checklist_item`.

Install: Skills page → Browse → install each. No auto-install, no migrations.
