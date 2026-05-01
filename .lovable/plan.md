## Scope

Add one new skill manifest: `marketing-orchestrator`. It's the front door for the 10 marketing skills — users say "help me with marketing" / "write an ad" / "improve my page" and this skill picks the right sub-skill (and ensures `product-marketing-context` runs first).

No code changes. No DB migration. No UI changes. One new JSON file.

## Why a skill, not router code

Ozlon's skill loop already supports composition: a loaded skill's instructions can tell the model to call `load_skill(slug)` to hand off. That's exactly what the orchestrator does. Keeping it as a manifest means it's installable, versionable, and overridable like any other skill.

## File added (1)

`public/sample-skills/marketing-orchestrator.skill.json`

### Behavior encoded in instructions

1. **Triage** the user's ask in one sentence (no preamble).
2. **Context gate** — if `marketing.product_context.brief.v1` is missing in memory, hand off to `product-marketing-context` first via `load_skill`, then resume.
3. **Route** to exactly one sub-skill using a decision table baked into the instructions:

   | User intent | Hand off to |
   |---|---|
   | Write/rewrite copy, headlines, CTAs | `copywriting` |
   | Audit a landing or pricing page | `page-cro` |
   | SEO audit, ranking issues, GSC | `seo-audit` |
   | LLM citations, GEO, AI search | `ai-seo` |
   | Outbound cold email | `cold-email` |
   | Welcome / nurture / launch sequence | `email-sequence` |
   | Meta / TikTok / YouTube / Google ads | `ad-creative` |
   | Tracking, GA4 events, measurement | `analytics-tracking` |
   | Reviews, JTBD, voice-of-customer | `customer-research` |
   | Set or update brand DNA | `product-marketing-context` |

4. **Ambiguous** — if two skills tie, present 2 options in one line and ask the user to pick. Never run two in parallel.
5. **Out of scope** — if the ask isn't marketing (e.g. "summarize my email"), say so in one line and stop. Don't try to absorb non-marketing work.
6. **Always** end the routing turn with a one-line confirmation of which skill it's handing off to, then call `load_skill(slug)`.

### Manifest fields

- `slug`: `marketing-orchestrator`
- `triggers` (keyword): `marketing`, `marketing help`, `grow`, `growth`, `acquisition`, `improve marketing`, `marketing plan`, `which marketing skill`
- `tools_required`: `["load_skill", "search_wisdom_memories"]`
- `tools_optional`: `["save_memory"]`
- `memory_domains`: `["marketing.product_context"]`
- `modes_allowed`: `["focus", "planning", "reactive"]`
- `side_effect`: `read`
- `requires_confirmation`: `false`

### Tone rules in instructions

Plain-speak. Max 14 words per sentence. No emojis. Calm, decisive — same Jarvis/Batman tone the rest of the marketing pack uses. Never list all 10 skills to the user; just pick.

## Stop point

Ship the one file. No edits to `Skills.tsx`, no edits to existing skill manifests, no edge function changes. Verification + UI grouping deferred to follow-ups.
