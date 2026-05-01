---
name: Marketing pack orchestration
description: How the marketing-orchestrator skill routes to the 10 sub-skills, gates on brand context, and learns routing patterns over time via wisdom memory.
type: feature
---
The Marketing Pack ships 11 skills seeded into `public.skills` (source=builtin, visibility=public). Users install via Skills → Browse.

`marketing-orchestrator` is the front door. On every invocation it:
1. Recalls past routing patterns via `search_wisdom_memories(memory_type=pattern)`. High-similarity overrides win.
2. Gates on brand context — if no `marketing.product_context` brief exists, hands off to `product-marketing-context` first.
3. Routes to exactly one of: `copywriting`, `page-cro`, `seo-audit`, `ai-seo`, `cold-email`, `email-sequence`, `ad-creative`, `analytics-tracking`, `customer-research`, `product-marketing-context`.
4. Hand-off via `load_skill(<slug>)`. Never runs work itself.
5. Saves a `pattern` memory after each route so the system learns ("when user says X, route to Y").
6. Durable user feedback ("always do X with copywriting") is persisted via `add_skill_prerequisites` or `update_skill` on the target sub-skill, NOT just as memory.

Required chat tools: `load_skill`, `search_wisdom_memories` (added 2026-05-01), `save_memory`, `update_skill`, `add_skill_prerequisites`. All exposed in `supabase/functions/chat/index.ts` and listed in `_shared/skills/tool-catalog.ts`.

Every sub-skill calls `search_wisdom_memories` first to load `marketing.product_context.brief.v1`. If it's missing they refuse and route back to `product-marketing-context`.
