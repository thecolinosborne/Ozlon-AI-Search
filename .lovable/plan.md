# Why you don't see the skills

The Skills page reads from the `skills` table in the backend. Your DB currently only has 4 skills (`ab-test-setup`, two `higgsfield-ad-director`, `marketing-studio-director`). All the PM and marketing skill files we wrote live in `public/sample-skills/` but were never seeded into the catalog, so they don't appear in Browse.

On top of that, only one generic `social-post` skill exists — there's no per-channel coverage.

# What I'll do

## 1. Seed the catalog (one migration)

Insert every file in `public/sample-skills/` into `skills` as `source='builtin'`, `trust_tier=1`, `visibility='public'`. After this you'll see them all under Browse and can Install per skill.

Skills to seed (30 existing files):
- **PM pack** (5): pm-orchestrator, pm-breakdown, pm-prioritize, pm-assign, pm-roadmap
- **Marketing pack** (15): marketing-orchestrator, copywriting, ad-creative, email-sequence, cold-email, customer-research, product-marketing-context, brand-voice-guardian, content-calendar, social-post, landing-page-builder, competitor-watch, page-cro, ai-seo, seo-audit, analytics-tracking
- **Higgsfield pack** (9): orchestrator + 8 sub-skills

## 2. Add channel-specific social skills

Replace the single generic `social-post` with a router + channel experts. New files in `public/sample-skills/`:

- `social-x.skill.json` — X/Twitter posts + threads (≤280, hook rules, no hashtag spam)
- `social-linkedin.skill.json` — Long-form posts, carousels, newsletter intros (1300–2200 chars, mobile fold)
- `social-instagram.skill.json` — Captions, Reels scripts, carousel scripts (125-char fold, hashtag strategy)
- `social-facebook.skill.json` — Feed posts, group posts, Reels copy (community-tone)
- `social-tiktok.skill.json` — Short-form video scripts, hook-in-3-seconds, on-screen text, captions
- `social-youtube.skill.json` — Long-form titles, descriptions, chapters, end-screen CTAs + Shorts variant
- `social-threads.skill.json` — Conversational threads, ≤500 chars per post
- `social-pinterest.skill.json` — Pin titles, descriptions, board ideas, keyword-led
- `social-router.skill.json` — Picks the right channel skill based on keywords, runs multi-channel fan-out when asked ("post this everywhere")

Keep existing `social-post.skill.json` as a thin alias that delegates to `social-router` so installed users don't break.

Each channel skill follows the same pattern already shipped:
- Recall brief + outcomes + corrections from `wisdom_memories`
- Channel-specific limits / hook patterns / forbidden behavior
- Run through `brand-voice-guardian` before returning
- Record `pattern` memory on success, `correction` on next-turn pushback

## 3. Update orchestrators

- `marketing-orchestrator.skill.json` v1.3.0 — route social intent to `social-router` instead of `social-post`. Bumps routing table to 23 sub-skills.
- `social-router` knows the 8 channel skills and the multi-channel fan-out flow (generates per-channel variants in one turn, each respecting its own rules).

## 4. Memory doc

Update `.lovable/memory/features/marketing-pack-orchestration.md` to reflect the new social sub-pack and routing.

# Technical notes

- Migration uses `insert ... on conflict (slug) do update` so re-runs are safe and any future edits to the JSON files can be re-seeded.
- `manifest` column gets the full JSON body; `name`, `description`, `version`, `slug` are extracted for list rendering.
- No schema changes, no edge functions, no UI changes. Skills page already renders whatever's in the `skills` table.
- After migration runs you'll go to **Skills → Browse** and see ~38 skills. Install the social ones you want.

# What you'll do after

1. Open `/skills`
2. Under **Browse**, install: `social-router` + the channels you actually use (recommend all 8 for full coverage)
3. Make sure `marketing-orchestrator` is installed and enabled
4. Try: "write me an X thread and a LinkedIn post about [topic]" — the router fans out to both channel skills, each enforces its own rules, both pass brand-voice gate.
