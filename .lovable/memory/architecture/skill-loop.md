---
name: Skill loop — meta-skill self-improvement system
description: Adapts "One Skill to Rule Them All" (Eoghan Henn / rebelytics.com, CC BY 4.0) into Ozlon. Phase 1 ships silent observation capture; Phases 2-5 deferred.
type: feature
---

## What it is

A self-improvement loop that watches sessions for skill creation/improvement opportunities, drafts proposals, and stages them for user approval. Adapted from the "task-observer" methodology pack to fit Ozlon's RLS/privacy model — re-homed from a filesystem to Postgres, and reusing existing infrastructure wherever possible.

## Reuse map (decided)

- **Observations** → `reflection_notes.note_type='skill_observation'` (no new table)
- **Proposals (Phase 3)** → `system_evolution_proposals.proposal_type='skill_*'|'principle_new'` (no new table)
- **Cron pattern** → mirror `stack-resurface` (Mon/Wed/Fri 06:00 UTC)
- **Approval UI (Phase 3)** → extend `ProposalInbox.tsx` with a Skills tab
- **Stack surface (Phase 3)** → `signal_moments.kind='skill_proposal'` flows through existing `StackRow`

## What's actually new

- **Table**: `cross_cutting_principles` (owner-only RLS, service-role for cron). The one piece with no good existing home — universal authoring rules re-injected into every future skill build.
- **Edge function**: `skill-observer` (`verify_jwt = true`). End-of-session extractor. JWT-scoped Supabase client → RLS enforces user_id. Calls Lovable AI Gateway with `google/gemini-2.5-flash`. Writes to `reflection_notes`.
- **Hook**: `useSkillObservations` (count + recent + principles + `deactivatePrinciple`). `recordSkillObservations(...)` is fire-and-forget for callers.
- **UI**: `SkillLoopSection` on `/wisdom` — counts, recent observations, active principles with one-click deactivate.

## Phase 1 status (shipped)

Silent capture pipeline is live. Auto-trigger from chat lifecycle is **deferred** to avoid touching the 9.6k-line chat function (per stabilization policy). `recordSkillObservations` can be called from anywhere; wire-up happens in a follow-up.

## Security posture

- All client writes JWT-scoped, RLS owner-only.
- Confidentiality flag (`internal | open_source_candidate`) on every observation; defaults to `internal`.
- `cross_cutting_principles` are **never auto-created** — Phase 3 routes them through `system_evolution_proposals` for explicit user approval. One-click deactivate is mandatory (prompt-injection mitigation).
- Untrusted source content (email bodies, scraped pages) is excluded from principle synthesis at extraction time.
- AI-generated skills will default to `trust_tier=0`; promotion is user-only.
- No new external secrets. CC BY 4.0 attribution carried in `metadata.attribution` and edge function header.

## Deferred phases

- **2** — Manual principle curation UI on `/wisdom`.
- **3** — `skill-review` cron + ProposalInbox "Skills" tab + Stack rows + `approve_skill_proposal` SECURITY DEFINER.
- **4** — `skill-publish-scrub` for visibility=public promotion.
- **5** — Self-review (`metadata.kind='meta'` observations review the observer prompts).

## Constraints honored

- Additive only — zero edits to chat function or existing UI shells.
- No new "tasks" route.
- No filesystem mirror — Postgres is source of truth.
