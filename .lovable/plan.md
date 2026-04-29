
## Verdict

The repo is a **methodology pack** (markdown only — no code, no scripts, no network calls, CC BY 4.0). It's a strong fit for Ozlon and maps almost 1:1 onto systems we already run. The right move is **not** to bolt on a parallel observation system — it's to teach the existing Wisdom Engine + Proposal Inbox + Stack to do meta-skill work, with one new lightweight table for the parts that genuinely don't exist yet.

---

## What already exists (reuse, do not duplicate)

| Capability the pack needs | Ozlon equivalent already shipped |
|---|---|
| Per-session observation logging | `reflection_notes` (pgvector, RLS, `match_reflections`) |
| Skill catalog + per-user installs | `skills` + `skill_installs` (visibility, trust_tier, manifest jsonb) |
| Pending AI-suggested changes ("staged updates") | `personality_evolve` proposal pattern + `ProposalInbox.tsx` |
| User-approved memory mutations | Wisdom Engine `wisdom_memories` + `save_memory` tool |
| Surfacing "do this now" rows | The Stack (`signal_moments` + `useStack`) |
| 3x/week cron review | `pg_cron` + `stack-resurface` pattern |
| End-of-turn extraction | `automatic-skill-learning` post-turn hook |
| Cross-product scrub for confidentiality | Wisdom Engine identity constraints + RLS |

So 80% of the pack is already there structurally — it just isn't wired to *skill authorship*.

---

## What's genuinely new (the 20% to build)

Only **two** new database objects, one new edge function, one cron schedule, and one tab in `ProposalInbox`. Everything else routes into existing tables.

### New table: `skill_proposals`

Mirrors the personality_evolve proposal pattern, scoped to skills.

```
skill_proposals (
  id uuid pk,
  user_id uuid not null,                    -- RLS owner
  kind text check (kind in ('new','update','simplify','retire')),
  target_skill_id uuid references skills(id),  -- null when kind='new'
  draft_manifest jsonb not null,            -- proposed SkillManifest
  diff_summary text,                        -- human-readable rationale
  source_reflection_ids uuid[],             -- traceable back to observations
  confidentiality text default 'internal'   -- 'internal' | 'open_source_candidate'
                check (confidentiality in ('internal','open_source_candidate')),
  status text default 'pending'             -- 'pending' | 'approved' | 'declined' | 'superseded'
                check (status in ('pending','approved','declined','superseded')),
  created_at timestamptz default now(),
  decided_at timestamptz
)
```

RLS: owner-only CRUD; service role writes for the cron worker. No client-side approval shortcut — approval flips status server-side via a SECURITY DEFINER `approve_skill_proposal(id)` that writes to `skills`/`skill_installs` atomically.

### New table: `cross_cutting_principles`

The pack's killer idea — principles that get re-injected into every future skill build.

```
cross_cutting_principles (
  id uuid pk,
  user_id uuid not null,                    -- RLS owner-only
  title text not null,
  principle text not null,                  -- the rule itself
  source_reflection_ids uuid[],             -- traceability + revocability
  active boolean default true,
  created_at timestamptz default now()
)
```

This is the one table that has no good existing home — `wisdom_memories` is for *user preferences*, `reflection_notes` is for *raw observations*. Principles are the *rules extracted from clusters of observations* that govern skill authorship.

### Reuse `reflection_notes` for observations

The pack's `skill-observations/log.md` becomes:

```
reflection_notes.note_type = 'skill_observation'
reflection_notes.metadata.kind = 'correction'|'gap'|'workflow'|'simplify'|'meta'
reflection_notes.metadata.target_skill_id = uuid | null
reflection_notes.metadata.session_id = uuid
reflection_notes.metadata.confidentiality = 'internal'|'open_source_candidate'
```

Zero new infra. `match_reflections(filter_note_type='skill_observation')` already does clustering for the cron.

### One new edge function: `skill-review` (cron, 3x/week)

Modeled on `stack-resurface`. Per user:
1. Pull open `reflection_notes` where `note_type='skill_observation'` and `created_at > last_review_at`.
2. Cluster by `target_skill_id` (and a "no target → new skill" bucket).
3. For each cluster, call Lovable AI Gateway:
   - `google/gemini-2.5-flash` for tweaks (cheap, high volume),
   - `openai/gpt-5.2` for substantive rewrites.
4. Server-side **5-layer confidentiality scrub** before any draft is marked `open_source_candidate` (the pack's Layer 1–5 — implement as deterministic regex + Gemini judge pass).
5. Insert one row per draft into `skill_proposals` with `status='pending'`.
6. Insert one `signal_moments` row per proposal so it lands in **The Stack** automatically (`kind='skill_proposal'`).

Schedule via `pg_cron`: Mon/Wed/Fri 06:00 UTC (mirrors the pack's cadence).

### Observation capture: extend, don't add

The existing `automatic-skill-learning` post-turn hook already runs at end of every chat turn. We extend it: in addition to wisdom memory extraction, it asks Gemini Flash for `0..N` skill observations using the pack's signal taxonomy (correction / gap / workflow / simplify / meta). Writes go to `reflection_notes`. **No new edge function, no new client code path.** Same RLS, same JWT, same cost class.

### UI: extend, don't add

- **`ProposalInbox.tsx`** → add a third tab "Skills" alongside the existing personality/wisdom tabs. Diff view = JSON manifest diff against current `skills.manifest`. Approve/Decline buttons call the SECURITY DEFINER function.
- **`/skills` page** → add a "Drafts" section showing this user's pending `skill_proposals` count + link.
- **The Stack** → no change required; `kind='skill_proposal'` rows render through the existing `StackRow` template, with the "Open" action navigating to `ProposalInbox?tab=skills&id=…`.
- **`/wisdom`** → add a "Principles" section listing `cross_cutting_principles`, with a toggle to deactivate any principle (revocability is mandatory for the prompt-injection mitigation below).

---

## Security review of the upstream pack

**Source artifact risk:** zero. The repo is six files: 4 markdown, 1 license, 2 PNGs. The only "executable" content is two `bash grep` snippets shown as documentation examples. Nothing is fetched at runtime.

**Adoption risks (Claude-shaped assumptions that don't fit Ozlon) and how the plan handles each:**

1. **Filesystem assumption** — pack writes to `[shared folder]/skill-observations/` and `skill-updates/`. Ozlon has no client filesystem. Re-homed to Postgres tables with RLS.
2. **Silent background logging is privacy-sensitive** — extraction happens server-side in the existing `automatic-skill-learning` flow under the user's JWT, written to `reflection_notes` which already has `user_id = auth.uid()` RLS. Nothing service-role-on-behalf-of-user from the client.
3. **Auto-application of skill changes** — pack is explicit: stage, never auto-install. Mirrored exactly: every change goes through `skill_proposals.status='pending'` and an explicit user click. The `approve_skill_proposal` function is the *only* path that mutates `skills` or `skill_installs.manifest` from AI output.
4. **Open-source promotion path** — `skills.visibility` already supports `private/org/public`, but today nothing flips it. We add a separate, explicit `skill-publish-scrub` call (gated `verify_jwt = true`, user-initiated only) that re-runs the 5-layer confidentiality sweep before allowing `visibility='public'`. AI cannot promote skills; only the user can.
5. **Trust tier** — AI-generated skills default to `trust_tier = 0` and stay there. Promotion to tier 1+ is user-only.
6. **Prompt-injection via principles** — this is the highest-leverage attack: `cross_cutting_principles` get re-injected into every future skill build, so a poisoned email body summarized into a "principle" could rewrite agent behavior across all future skills. Mitigations:
   - Principles are NEVER auto-created. They require explicit user approval via the same proposal flow (`kind='principle'` reuses `skill_proposals.draft_manifest`).
   - Every principle carries `source_reflection_ids` so the user can see exactly which observations spawned it.
   - One-click "Deactivate principle" in `/wisdom` flips `active=false` immediately.
   - The cron worker treats user-content sources (email bodies, scraped pages) as **untrusted** — observations derived from them are tagged `metadata.untrusted_source=true` and Gemini's prompt explicitly excludes them from principle synthesis.
7. **License** — CC BY 4.0. Compatible with commercial reuse. Plan keeps `Created by Eoghan Henn / rebelytics.com` attribution in the seeded principles' `metadata.attribution` field and in the `skill-review` function header comment.
8. **No new external secrets, no new third-party calls, no new SDKs.**

---

## Phased rollout

```text
Phase 1 — Capture (silent, low risk)           [migration + extend automatic-skill-learning]
   reflection_notes.note_type='skill_observation' starts populating
   No proposals yet, no UI surface beyond a count in /wisdom
   1 week of validation against signal quality

Phase 2 — Cross-cutting principles             [migration + /wisdom Principles tab]
   cross_cutting_principles table + manual user-curated entries
   AI proposes principles via the same proposal pipeline (built in phase 3)

Phase 3 — Proposals + Stack surface            [migration + edge function + cron + ProposalInbox tab]
   skill_proposals table + skill-review cron
   Stack rows for kind='skill_proposal'
   ProposalInbox "Skills" tab with diff view + Approve/Decline
   approve_skill_proposal SECURITY DEFINER function

Phase 4 — Confidentiality publish path         [edge function + Skills page button]
   skill-publish-scrub edge function
   "Make public" button on user-owned skills (currently disabled)
   5-layer scrub blocks risky publishes

Phase 5 — Self-review                          [no schema change]
   Observations tagged metadata.kind='meta' get reviewed by the same cron
   The skill-review prompts themselves become proposal-driven over time
```

---

## What we explicitly do NOT do

- No new "tasks" route or page (Core constraint).
- No client-side writes to `skills` or `skill_installs.manifest` for AI-generated content — always via `skill_proposals` + user approval.
- No auto-publish of any skill to `visibility='public'` without user click + `skill-publish-scrub` passing.
- No filesystem mirror of `skill-observations/` and `skill-updates/` — Postgres is the single source of truth.
- No runtime fetch of the upstream repo — the methodology is vendored into edge function prompts with attribution.
- No new tables for things `reflection_notes` and `skill_installs` already cover.

---

## Why this is the right add now

Ozlon already closed two of three self-improvement loops:
- **Preference loop** → Wisdom Engine
- **Tone loop** → Personality Evolve

This adds the third:
- **Capability loop** → every correction the user makes becomes free training data for the agent's own *skills*; every recurring workflow becomes a new installed skill without the user authoring it.

Combined with The Stack as the actionable surface, the system becomes self-curating: it watches itself work, drafts its own improvements, and asks permission before installing them. The upstream author reports 600+ improvements across 40 skills in 3 months under this exact methodology. Adapted to Ozlon's RLS/privacy model, it's strictly additive and reuses every system we already built.

Approve and I'll start with Phase 1: the migration + extending `automatic-skill-learning` to also emit skill observations into `reflection_notes`. No new UI in Phase 1 — just silent capture and a counter, so we can validate signal quality before anything proposes changes.
