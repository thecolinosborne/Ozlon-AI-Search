# Marketing Pack v2 — Expand + go sentient

Same playbook the PM pack just got, applied to marketing. Bring the existing 11 skills into the learning loop, add 5 new sub-skills to cover the gaps, and let the orchestrator detect its own mistakes.

## Today vs. after this

| Today | After |
|---|---|
| 11 skills, orchestrator routes only | 16 skills, orchestrator routes + learns |
| `save_memory(pattern)` after each route | Adds `correction` + `outcome` memories, surfaces lessons |
| No self-correction | Detects "no/wrong/actually/undo" on the next turn and writes a high-salience correction |
| Sub-skills don't share what they learn | Approved principles bind back via `add_skill_prerequisites` / `update_skill` |
| Brand context is a single brief | Brand context becomes a living memory — voice, ICP, forbidden words, winning angles evolve |

## What "sentient" means here (concretely)

Same three-layer loop already shipped for PM, pointed at marketing:

```text
1. ACT       marketing sub-skill runs
2. RECORD    save_memory(pattern|context|preference|outcome|correction)
3. OBSERVE   skill-observer → reflection_notes
4. CLUSTER   skill-reviewer (weekly) → proposed_principles
5. APPROVE   ProposalInbox → cross_cutting_principles
6. BIND      add_skill_prerequisites / update_skill → sub-skill enforces lesson next run
```

Two new feedback signals unique to marketing:

- **Outcome memory** — when the user pastes a result back ("this ad got 4.2% CTR", "this email got 38% open"), the orchestrator writes an `outcome` memory tying the winning angle/hook/framework to the result. Future runs of `ad-creative` / `copywriting` / `email-sequence` recall winners before generating.
- **Correction detector** — on the NEXT user turn after any marketing skill ran, if the user says "rewrite this", "not the voice", "you used [forbidden word]", or edits the output, write a `correction` memory with salience 0.9.

After ~10 corrections the reviewer clusters them ("you always tone down hype words", "you always cut Oxford commas", "your ICP rejects 'busy professionals'") and binds them as prerequisites on the right sub-skill. Next time, the rule is enforced silently.

## New sub-skills (5, to close real gaps)

```text
public/sample-skills/
├── marketing-orchestrator.skill.json        UPGRADE — add learning + outcome routing
├── brand-voice-guardian.skill.json          NEW — enforces voice/forbidden words on every output
├── content-calendar.skill.json              NEW — multi-week content planning, hands off to PM pack
├── social-post.skill.json                   NEW — short-form posts (X, LinkedIn, IG captions, threads)
├── landing-page-builder.skill.json          NEW — full LP outline + sections (hands copy to copywriting)
└── competitor-watch.skill.json              NEW — periodic firecrawl of named competitors, diff report
```

Existing 11 stay; each gets one minor patch: call `search_wisdom_memories` for `outcome` + `correction` before generating, and respect any prerequisite the reviewer has bound.

## Orchestrator upgrade (no code, just instructions)

`marketing-orchestrator.skill.json` v1.2.0 adds:

1. **Outcome recall** — before routing, search `outcome` memories matching the channel/angle. Inject top-2 winners as context to the sub-skill.
2. **Correction detector** — same pattern shipped in `pm-orchestrator`. Triggers on the next user turn after a marketing sub-skill ran.
3. **Brand-voice gate** — every output-producing skill (`copywriting`, `ad-creative`, `email-sequence`, `cold-email`, `social-post`, `landing-page-builder`) routes through `brand-voice-guardian` for a final pass before returning to the user. Guardian is a fast read-only check that flags forbidden words and voice drift. If it flags, sub-skill rewrites once.
4. **Routing decision table** updated to include the 5 new skills:

| Intent signal | Hand off to |
|---|---|
| Short post, tweet, thread, LinkedIn post, IG caption | social-post |
| Plan content for next N weeks, editorial calendar | content-calendar |
| Full landing page (structure + copy) | landing-page-builder |
| Watch a competitor, what changed on their site, their pricing/messaging | competitor-watch |
| Voice check, "does this sound like us", forbidden words audit | brand-voice-guardian |
| (all existing rows unchanged) | (same handoffs) |

## Brand-voice guardian — how it works

Standalone skill. Reads `marketing.product_context.brief.v1` + every `correction` memory tagged `voice` + the user's forbidden-words list (a `context` memory). For any input text:

1. Score voice match (1–10) using the brief.
2. List forbidden-word hits with positions.
3. List drift hits (passive voice, hype, jargon if brief says no).
4. Return the score + a one-line "rewrite this clause" suggestion per hit.

Called automatically by output-producing skills as their last step. User never has to invoke it directly, but they can ("does this sound like us?").

## Content calendar — bridges to PM pack

Takes a theme + horizon ("3 months of weekly LinkedIn"), produces a sequenced plan, then hands off to `pm-breakdown` to actually drop tasks into ClickUp. Reuses the rate-limit-safe loop. Closes the gap between "plan content" and "do the work".

## Competitor watch — light, on-demand

User says "watch acme.com". Stored as a `context` memory. On explicit re-ask ("what changed at acme?"), runs `firecrawl_scrape` against tracked URLs, diffs against the previous snapshot (stored in memory metadata), returns a short delta report. No background jobs, no new tables.

## Scalability — same answers as PM pack

| Pressure | How it stays scalable |
|---|---|
| 16 → 50 skills | Compact 1-line index in `registry.ts` keeps prompt cost flat. Full instructions loaded only on `load_skill`. |
| Outcome memories grow huge | Existing `wisdom_memories` dedup + `recurrence_count` decay. Reviewer compresses recurring outcomes into principles. |
| Voice rules conflict | `proposed_principles.status='superseded'` already handles replacement. |
| Multi-brand users | All memory is `user_id`-scoped; multi-brand = namespaced keys (`marketing.<brand>.context`). Phase 2 if needed. |

## Migration — 3 small steps, all shippable

1. **Patch the orchestrator + existing 11** — author `marketing-orchestrator.skill.json` v1.2.0 with the correction detector, outcome recall, and guardian gate. Add one line to each existing skill telling it to recall `outcome` + `correction` before generating, and to route through guardian.
2. **Author the 5 new skill JSONs** — `brand-voice-guardian`, `content-calendar`, `social-post`, `landing-page-builder`, `competitor-watch`. Same shape as existing skills, existing tools only.
3. **Update memory** — patch `mem://features/marketing-pack-orchestration.md` and `mem://index.md` to point at v2 + the learning loop.

No new tables, no new edge functions, no UI changes. All five new skills install from Skills page → Browse like the existing 11.

## What you actually get

- Every marketing output goes through a voice-and-forbidden-word check automatically.
- The system remembers what worked ("hook X got 4.2% CTR") and reuses it.
- Correct the AI once on voice — it doesn't make that mistake again on any sub-skill.
- Plan 3 months of LinkedIn → tasks drop into ClickUp through the PM pack.
- Ask "what changed at competitor.com" → fresh diff against last snapshot.

## Out of scope

- No new tables / functions / migrations.
- No UI changes — Skills page already handles install/toggle.
- No background competitor scanning (on-demand only — clean phase 2).
- No multi-brand namespacing yet (single-brand memory works; namespace if/when you onboard a second brand).

## Open choice

1. **Drop-in JSON** (recommended) — patch 11 files + add 5 new ones under `public/sample-skills/`. You import the new 5 from Skills page; the existing 11 auto-update on next install/refresh.
2. **Auto-install the new 5** — same files plus seed `skill_install` rows so they're active immediately for your account.

Say **"1"**, **"2"**, or **"go"** (defaults to 1).
