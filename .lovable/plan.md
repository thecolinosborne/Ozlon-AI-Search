
## Scope

Port the first 3 marketing skills from `coreyhaines31/marketingskills` into Ozlon's existing skill manifest format. Minimal, additive, no DB migrations.

## Files changed (5 total)

1. **Delete** `public/sample-skills/marketing-studio-director.skill.json` (outdated drop-in).
2. **Create** `public/sample-skills/product-marketing-context.skill.json`
3. **Create** `public/sample-skills/copywriting.skill.json`
4. **Create** `public/sample-skills/seo-audit.skill.json`
5. **Edit** `src/pages/Skills.tsx` — add a single attribution line in the page footer.

No edge function changes. No DB migrations. No type changes. No touch to other skills.

## Schema adjustments made (vs the drafted JSON)

The drafted JSON used Claude/OpenAI-style trigger shape (`{ type, value }`) and external-API tool names (e.g. `google-docs.create_document`, `firecrawl.scrape`, `google-search-console.query`). I normalized both to Ozlon's actual schema:

**Trigger shape** — `SkillManifest` in `supabase/functions/_shared/skills/types.ts` defines triggers as `{ type: "keyword"; match: string[] }`. The existing `marketing-studio-director.skill.json` ships the legacy `value: "..."` shape, but the adapter (`supabase/functions/_shared/skills/adapter.ts` lines 148-158) explicitly normalizes it. To stay forward-compatible I used the canonical `match: ["..."]` array form (same shape as `src/pages/SkillImport.tsx:26`).

**Tool name remapping** — All names mapped to entries in `supabase/functions/_shared/skills/tool-catalog.ts`:

| Drafted name | Ozlon tool |
|---|---|
| `save_memory` | `save_memory` ✓ |
| `firecrawl.scrape` | `scrape_url` |
| `google-docs.create_document` | `create_google_doc` (+ `docs_apply_markdown` to write body) |
| `google-search-console.list_sites` / `.query` | `gsc_query` (single tool, no separate list step) |
| `google-analytics.run_report` | `ga_query` |
| `web_search_google` | `web_search_google` ✓ |
| `search-atlas.site_audit` | dropped (no Ozlon tool exposed in catalog) |
| `firecrawl.crawl` | dropped (catalog only exposes single-page `scrape_url`); audit can iterate scrapes |
| memory recall (implicit) | added explicit `search_wisdom_memories` |

**Memory-domain registration (requirement 5)** — In Ozlon, memory domains are not registered in a separate table. They are free-form strings declared in each skill's `memory_domains` array (see `supabase/functions/_shared/skills/types.ts:19` and `registry.ts:63-66`). Declaring them in the three manifests is the lightest equivalent and matches existing convention. No seed migration needed.

**Modes / side_effect / requires_confirmation** — Set per skill, all valid against the type union.

## Final JSON — file 1 of 3

`public/sample-skills/product-marketing-context.skill.json`

```json
{
  "slug": "product-marketing-context",
  "name": "Product Marketing Context",
  "version": "1.0.0",
  "description": "Captures and recalls the user's product, audience, positioning, and brand voice so every other marketing skill stays consistent. Adapted from coreyhaines31/marketingskills (MIT).",
  "triggers": [
    { "type": "keyword", "match": ["product context", "brand context", "positioning", "ICP", "ideal customer", "value prop", "brand voice", "tone of voice", "update marketing context"] },
    { "type": "intent", "match": "marketing.context" }
  ],
  "tools_required": ["save_memory", "search_wisdom_memories"],
  "memory_domains": ["marketing.product_context"],
  "modes_allowed": ["planning", "reactive"],
  "side_effect": "write",
  "requires_confirmation": false,
  "instructions": "You maintain the user's marketing product context. This brief is the foundation every other marketing skill reads first.\n\nOn every invocation:\n1. Call `search_wisdom_memories` scoped to domain `marketing.product_context`. If a `brief.v1` entry exists, summarize what we already know in 5 short lines and confirm it is current.\n2. Identify gaps in: product, primary audience / ICP, top 3 jobs-to-be-done, positioning vs alternatives, pricing model, brand voice (3 adjectives), forbidden words, proof points (metrics, customers, awards).\n3. Ask only for the missing fields, one at a time, in plain-spoken sentences (max 14 words). No emojis. Calm, concise tone.\n4. After each answer, persist it via `save_memory` with domain `marketing.product_context` and a key matching the field (e.g. `product`, `icp`, `voice.adjectives`).\n5. When all fields exist, write a single 8-line consolidated brief to `marketing.product_context` under key `brief.v1`.\n6. Never proceed with another marketing skill until `brief.v1` exists. If a sibling skill is invoked first, run silently to load context, then yield back.\n\nFailure modes:\n- Memory search returns nothing → treat as a fresh brand and start at step 2.\n- User refuses to answer a field → record `unknown` for that key and continue; flag it in the brief."
}
```

## Final JSON — file 2 of 3

`public/sample-skills/copywriting.skill.json`

```json
{
  "slug": "copywriting",
  "name": "Conversion Copywriting",
  "version": "1.0.0",
  "description": "Writes or rewrites marketing copy (homepage, landing, pricing, feature, hero) using proven conversion frameworks. Outputs into a Google Doc the user can edit. Adapted from coreyhaines31/marketingskills (MIT).",
  "triggers": [
    { "type": "keyword", "match": ["write copy", "rewrite copy", "headline", "subheadline", "hero copy", "above the fold", "CTA copy", "value proposition", "tagline", "landing page copy", "make this more compelling"] }
  ],
  "tools_required": ["create_google_doc", "docs_apply_markdown"],
  "tools_optional": ["scrape_url", "search_wisdom_memories", "save_memory"],
  "memory_domains": ["marketing.product_context", "marketing.copy_history", "marketing.references.copywriting"],
  "modes_allowed": ["focus", "reactive"],
  "side_effect": "write",
  "requires_confirmation": false,
  "instructions": "You are an expert conversion copywriter.\n\nBefore writing:\n- Use `search_wisdom_memories` to load `marketing.product_context.brief.v1`. If missing, instruct the user to run the `product-marketing-context` skill first, then stop.\n- If the user gave a URL of an existing page, call `scrape_url` (markdown) to read the current copy.\n- Optionally consult `marketing.references.copywriting` for stored framework cheatsheets.\n\nFrameworks (pick one and name it in the deliverable): PAS, AIDA, 4 U's, Before-After-Bridge, StoryBrand. Default to PAS for ads, BAB for landing heroes, StoryBrand for homepages.\n\nRules:\n- One idea per line. No corporate filler. Max 14 words per sentence in heroes. No emojis.\n- Lead with outcome, not feature. Show proof within first 2 sections.\n- Match the brand voice adjectives in memory. Avoid words listed as forbidden.\n- Always produce: H1, sub-H1, 1 primary CTA, 1 secondary CTA, 3 benefit bullets, 1 social proof line.\n\nDeliverable:\n- Create a Google Doc titled `Copy — <page name> — <YYYY-MM-DD>` via `create_google_doc`, then write the body via `docs_apply_markdown`.\n- Doc body sections: framework name, draft, 2 alternate H1s, rationale (3 lines).\n- Reply with the Doc URL and a 3-line summary. Offer to A/B test or refine.\n- Persist a 1-line memory via `save_memory` under `marketing.copy_history` with the page name, date, and Doc URL.\n\nFailure modes:\n- Doc creation fails → return the draft inline and ask the user to retry the Doc step.\n- No product context → do not improvise; route to `product-marketing-context`."
}
```

## Final JSON — file 3 of 3

`public/sample-skills/seo-audit.skill.json`

```json
{
  "slug": "seo-audit",
  "name": "SEO Audit",
  "version": "1.0.0",
  "description": "Runs a structured SEO audit on a domain or page using Search Console, GA4, and Firecrawl, then delivers a prioritized fix list as a Google Doc. Adapted from coreyhaines31/marketingskills (MIT).",
  "triggers": [
    { "type": "keyword", "match": ["seo audit", "audit my site", "seo issues", "ranking drop", "why am I not ranking", "technical seo", "crawl my site", "seo report"] }
  ],
  "tools_required": ["gsc_query", "scrape_url", "create_google_doc", "docs_apply_markdown"],
  "tools_optional": ["ga_query", "web_search_google", "search_wisdom_memories", "save_memory"],
  "memory_domains": ["marketing.product_context", "marketing.seo_audits", "marketing.references.seo-audit"],
  "modes_allowed": ["focus"],
  "side_effect": "write",
  "requires_confirmation": false,
  "instructions": "You produce a structured SEO audit.\n\nInputs:\n- Required: domain or URL.\n- Optional: target keywords, country, comparison period.\n\nFlow:\n1. Use `search_wisdom_memories` to load `marketing.product_context.brief.v1` for positioning context.\n2. Pull last 28d clicks / impressions / CTR / position by query and by page (top 50 each) via `gsc_query`. If GSC is not connected, stop and ask the user to connect Search Console.\n3. If GA4 is connected, pull organic sessions and conversions for the same window via `ga_query`.\n4. `scrape_url` the homepage and the top 5 organic landing pages (markdown + metadata).\n5. Optionally `web_search_google` for the top 3 target queries to spot the live competitive set.\n\nAnalysis (score each 1-5 with one-line rationale):\n- Indexability and crawlability\n- Title and meta quality\n- Heading hierarchy\n- Content depth vs intent\n- Internal linking\n- Schema presence\n- Page speed signals from metadata\n- Cannibalization (duplicate target keywords)\n- Branded vs non-branded ratio (from GSC)\n- AI citation surface\n\nDeliverable:\n- Create a Google Doc titled `SEO Audit — <domain> — <YYYY-MM-DD>` via `create_google_doc`, then write the body via `docs_apply_markdown`.\n- Sections: Executive summary (5 lines), Top 10 prioritized fixes (effort × impact), Quick wins (≤2 hours), 30-day plan, Data appendix.\n- Reply with the Doc URL and the single highest-leverage move framed as the next action. Calm, concise tone. No emojis.\n- Persist a row via `save_memory` to `marketing.seo_audits` with date, domain, top-fix, Doc URL.\n\nFailure modes:\n- No GSC connection → stop, ask to connect Search Console.\n- Firecrawl 402 / scrape failure → tell user; do not silently degrade.\n- New site with <100 GSC clicks → switch register: produce a launch SEO plan instead of an audit."
}
```

## Attribution line in `src/pages/Skills.tsx`

Inserted at the bottom of `<main>`, just before the closing tag (after the Browse `<section>`, line ~153):

```tsx
<p className="text-xs text-muted-foreground/70 text-center pt-4">
  Marketing pack adapted from{" "}
  <a
    href="https://github.com/coreyhaines31/marketingskills"
    target="_blank"
    rel="noopener noreferrer"
    className="underline hover:text-foreground"
  >
    coreyhaines31/marketingskills
  </a>{" "}
  (MIT).
</p>
```

## Stop point

Stops after these 3 skills land. Remaining 7 (page-cro, ai-seo, cold-email, email-sequence, ad-creative, analytics-tracking, customer-research) deferred to a follow-up pass.

Approve and I'll ship in one pass.
