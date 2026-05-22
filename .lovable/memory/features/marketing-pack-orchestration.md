---
name: Marketing pack orchestration
description: Marketing-orchestrator v1.2 routes to 15 sub-skills, recalls outcomes + corrections, runs every output through brand-voice-guardian, and self-improves via the skill-reviewer loop.
type: feature
---

The Marketing Pack ships 16 skills (orchestrator + 15 sub-skills) seeded into `public.skills` and installable from Skills → Browse.

`marketing-orchestrator` v1.2 is the front door. Per request it:
1. **Recalls three streams**: past routing `pattern`, prior `outcome` (winners on this channel/angle), recent `correction` memories — all via `search_wisdom_memories`.
2. **Gates on brand context** — no brief → routes to `product-marketing-context` first.
3. **Routes** to exactly one sub-skill from the v1.2 table (existing 10 + new: `social-post`, `landing-page-builder`, `content-calendar`, `competitor-watch`, `brand-voice-guardian`).
4. **Injects winners** into the handoff line so the sub-skill biases toward what worked.
5. **Brand-voice gate** — output-producing sub-skills (copywriting, ad-creative, email-sequence, cold-email, social-post, landing-page-builder) must run their draft through `brand-voice-guardian` before returning. Guardian is read-only, scores 1–10, flags forbidden words + drift with rewrite suggestions.
6. **Saves a `pattern` memory** after each route.
7. **Correction detector** runs on the NEXT user turn after any marketing skill ran. Triggers on "no/wrong/actually/rewrite/not the voice/etc." or hand-edited paste-backs. Writes `correction` memory with salience 0.9 and tag (voice / forbidden_word / length / angle).
8. **Outcome capture** when the user pastes a result ("4.2% CTR", "38% open"), writes `outcome` memory with salience 0.8 (0.95 if user calls it a winner).
9. **Durable feedback** — "always do X" rules go to `add_skill_prerequisites` on the target sub-skill or `update_skill` for deeper patches. Forbidden words append to a single `marketing.forbidden_words` context memory.

Learning loop (no new infra):
- Per turn → `save_memory(pattern|context|preference|outcome|correction)`.
- Per session → `skill-observer` writes `reflection_notes`.
- Weekly → `skill-reviewer` clusters fresh observations into `proposed_principles`.
- Approval in ProposalInbox → binds back via `add_skill_prerequisites` / `update_skill`.

New sub-skills shipped in v2:
- **brand-voice-guardian** — read-only voice + forbidden-word check, called by every output skill.
- **content-calendar** — multi-week/month content plans; hands off to `pm-breakdown` for ClickUp.
- **social-post** — X/LinkedIn/IG/threads with channel-aware hook patterns, 3-variant default.
- **landing-page-builder** — section-by-section LP outline → copy (delegates headline work to `copywriting`).
- **competitor-watch** — on-demand Firecrawl + hash diff against last snapshot stored in memory metadata.

Required chat tools (all pre-existing): `load_skill`, `search_wisdom_memories`, `save_memory`, `update_skill`, `add_skill_prerequisites`, `firecrawl_scrape`, `create_google_doc`, `docs_apply_markdown`. No registry changes.

Every output-producing sub-skill should recall `outcome` + `correction` before generating and route the final draft through `brand-voice-guardian`. The orchestrator reminds them in the handoff line.
