

# Viral Creative Intelligence Layer

## Summary
Add a strategic AI intelligence layer that analyzes source material, discovers viral angles, generates optimized prompts, scores creative concepts, and feeds the best prompts to Higgsfield for visual generation. Uses existing `LOVABLE_API_KEY` (Gemini/OpenAI via gateway). Fully additive — zero changes to existing systems.

## Architecture

```text
User enters campaign goal + references
  → viral-creative edge function (Lovable AI Gateway)
  → angle discovery + hook extraction
  → prompt generation optimized for Higgsfield
  → scoring + ranking
  → user selects top prompts → sends to Higgsfield
  → results stored in viral_creative_sessions
```

## Implementation

### 1. Database Migration
Two new tables with RLS (authenticated users CRUD own rows):

**`viral_creative_sessions`** — id, user_id, request_text, platform, content_goal, source_context (jsonb), angle_outputs (jsonb), hook_outputs (jsonb), prompt_candidates (jsonb), selected_prompts (jsonb), score_data (jsonb), output_metadata (jsonb), status text default 'pending', created_at, updated_at

**`creative_reference_assets`** — id, user_id, asset_type, source_url, notes, analysis (jsonb), metadata (jsonb), created_at

### 2. Edge Function: `supabase/functions/viral-creative/index.ts`
Action-based function using `LOVABLE_API_KEY` (already configured). No new secrets needed.

**Actions:**
- `analyze_angles` — generates 6-10 marketing angles from source material (problem/solution, transformation, urgency, authority, curiosity, etc.)
- `extract_hooks` — generates viral hook concepts (stop-scroll, emotional, polarizing, curiosity, authority)
- `generate_prompts` — creates Higgsfield-optimized prompts from selected angles, platform-aware (scene composition, visual emotion, ad framing, mobile-first)
- `score_concepts` — scores each prompt on hook strength, novelty, conversion potential, platform fit, repurpose potential (0-100)
- `cluster_content` — clusters mixed source material by themes, surfaces best creative opportunities
- `analyze_reference` — analyzes competitor/reference content for patterns without copying
- `repurpose` — transforms one concept into multiple format variants (static ad, video, reel, thumbnail, hero image, etc.)
- `generate_output_package` — for each prompt: title, angle name, hook line, caption, CTA, platform recommendation
- `full_pipeline` — runs complete flow: angles → hooks → prompts → scoring → packaging
- `list_sessions` / `get_session` — retrieve sessions from DB

Each action sends a specialized system prompt to the AI gateway with the user's context. Results persisted in `viral_creative_sessions`.

Config: `[functions.viral-creative] verify_jwt = false` in `supabase/config.toml`.

### 3. New Page: `src/pages/integrations/ViralCreativeDetail.tsx`
Detail page following existing integration patterns (IntegrationDetailLayout). Sections:

- **Auto-detect** on mount (calls gateway to verify `LOVABLE_API_KEY` works)
- **Higgsfield status** display (reads from integrations store)
- **Campaign Input**: textarea for offer/goal, platform dropdown (Instagram, Facebook, TikTok, YouTube, Landing Page, E-commerce), content goal dropdown (awareness, conversion, engagement, retargeting)
- **Reference Material**: textarea for competitor URLs/notes
- **Action Buttons**: Generate Angles, Generate Prompts, Score & Rank, Generate Visuals (calls Higgsfield), Repurpose, Analyze References
- **Results Display**: angles list with descriptions, prompt candidates with score breakdowns, caption/CTA/hook suggestions
- **Session History**: list of recent sessions
- **Fallback**: if intelligence layer fails, option to send raw prompt to Higgsfield directly

### 4. Route & Navigation (additive only)
- Add `Brain` icon import + entry in `Integrations.tsx` array: id `viral-creative`, path `/integrations/viral-creative`
- Add route in `App.tsx`: `<Route path="/integrations/viral-creative" element={<ViralCreativeDetail />} />`
- Import the new page component

### What stays untouched
- Chat edge function, Infinity Router, memory system, Descript, Higgsfield, Maton, GHL, ClickUp, AI Processor — zero changes
- All stores, services, hooks, core modules — zero changes

### Implementation Order
1. Database migration (2 tables + RLS policies)
2. Create edge function `viral-creative`
3. Add config to `supabase/config.toml`
4. Build `ViralCreativeDetail.tsx`
5. Add route + integration card
6. Test end-to-end

