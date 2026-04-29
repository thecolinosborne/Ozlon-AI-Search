---
name: Skill Loop Phase 3 Reviewer
description: Clusters captured skill observations into proposed cross-cutting principles for user approval. Wires chat session lifecycle into observation capture.
type: feature
---

# Skill Loop — Phase 3 (Reviewer + Chat Wiring)

Methodology adapted from "One Skill to Rule Them All" by Eoghan Henn (rebelytics.com), CC BY 4.0.

## Pipeline (now end-to-end)

1. **Capture (Phase 1)** — `useConversations.switchSession` / `startNewChat`
   call `recordSkillObservations` fire-and-forget when leaving a session with
   ≥4 messages. The `skill-observer` edge function extracts up to 5
   observations per call and writes to `reflection_notes` with
   `note_type='skill_observation'`. JWT-scoped, RLS-enforced.

2. **Manual curation (Phase 2)** — `PrincipleEditor` lets the user create,
   edit, pause, or delete principles directly in `cross_cutting_principles`.
   Manual entries carry `metadata.source = 'manual'`.

3. **Review (Phase 3)** — `skill-reviewer` edge function reads fresh
   observations from the last 30 days, EXCLUDES any already cited by an
   existing proposal or principle (idempotent), then asks Gemini Flash to
   cluster them into candidate principles. Each candidate writes one row to
   `proposed_principles` with `status='pending'`.

4. **Decision** — `ProposalInbox` UI surfaces pending proposals with
   observation count and confidence. Approve → row inserted into
   `cross_cutting_principles` (active=true) + proposal marked `approved`.
   Reject → proposal marked `rejected`. Both decisions are terminal and
   recorded with `decided_at`.

## Tables

- `reflection_notes` (existing) — observations live here under
  `note_type='skill_observation'`, with `metadata.kind` ∈ {correction, gap,
  workflow, simplify, meta}.
- `cross_cutting_principles` — accepted, binding rules.
- `proposed_principles` — pending candidates awaiting decision. Statuses:
  pending | approved | rejected | superseded.

## Hard rules

- All capture and review happens under the user's JWT; no service-role
  on-behalf-of-user writes.
- Reviewer only proposes if ≥3 fresh observations exist (or 1 high-importance).
- Idempotency: once an observation id appears in any proposal or principle's
  `source_reflection_ids`, it is excluded from future review runs.
- Phase 1 capture is silent and non-blocking — failures are swallowed, never
  surfaced to chat UX.

## Files

- `supabase/functions/skill-observer/index.ts` — Phase 1 capture
- `supabase/functions/skill-reviewer/index.ts` — Phase 3 cluster
- `src/hooks/useSkillObservations.ts` — read state + all mutators (incl.
  `runReviewer`, `approveProposal`, `rejectProposal`)
- `src/hooks/useConversations.ts` — `captureLeavingSession` triggers observer
  on `switchSession` / `startNewChat`
- `src/components/wisdom/PrincipleEditor.tsx` — Phase 2 manual editor
- `src/components/wisdom/ProposalInbox.tsx` — Phase 3 review surface
- `src/pages/Wisdom.tsx` — `SkillLoopSection` composes everything

## Phase 4 (deferred)

A 5-layer confidentiality scrub before any approved principle could be
proposed for sharing into a public skill marketplace. Not built.
