
User is asking for a summary, not new scope. Consolidate the three approved plans (humanize Brain page, live API key sync, video generation) into one clear list.

# What We're Building — One Pass

## 1. Clean up Integrations
- Remove **AI Processor** card from `/integrations` (redundant)
- Remove its route from `App.tsx`
- Drop default entry from `useIntegrationsStore`

## 2. Rebuild "Intelligence Routing" as the **Brain** page (`/settings/routing`)
Drop everything technical. Four sections:

**A. Connected Brains** (auto-detected)
- Gemini · OpenAI · Veo 3 → Connected via Lovable AI (masked key shown)
- Higgsfield → Connected (masked `HIGGSFIELD_API_KEY`) with Manage link
- Any custom stones the user has plugged in

**B. Add a Brain** (provider catalog with inline key input)
- Grok (xAI) · Claude (Anthropic) · Mistral · DeepSeek
- Each: paste API key → Connect → key stored as Supabase secret + row inserted in `custom_models` → instantly joins the Infinity Router via existing `loadCustomModels` + `mergeRegistry`
- "+ Custom OpenAI-compatible endpoint" → existing Stone Socket form

**C. What handles what?** (humanized, replaces per-agent dropdowns)
Plain English rows, each with Auto + every connected model:
- Quick thinking & routing
- Deep reasoning & tool use
- Image creation
- **Video creation** (new)
- Summaries

**D. How it's been performing**
24h telemetry — avg response time + reliability per role.

**Removed:** Speed/Balanced/Quality selector, raw "Available Models" toggles, cost-per-turn numbers.

## 3. Video Generation (new capability)
- New `video_gen` capability + `video_director` agent in registry
- Models: `google/veo-3-fast`, `google/veo-3` (Lovable AI), `higgsfield/dop-standard` (existing edge function)
- New edge function `video-gen/index.ts` — Veo wrapper + storage upload
- New chat tool `generate_video(prompt, duration?, aspect_ratio?)` wired into `chat/index.ts` with userId injection
- New public storage bucket `generated-videos`

## 4. New edge function `connect-brain`
- Stores user-provided API keys as Supabase secrets
- Inserts matching `custom_models` row with provider preset (gateway URL, capabilities)
- Returns success → frontend refreshes → router picks it up next request

## Files
- New: `supabase/functions/connect-brain/index.ts`, `supabase/functions/video-gen/index.ts`, migration for `generated-videos` bucket
- Edited: `src/pages/ModelRouting.tsx` (full rewrite, same route), `src/pages/Integrations.tsx`, `src/App.tsx`, `src/stores/useIntegrationsStore.ts`, `supabase/functions/_shared/model-registry.ts` (add Veo + Higgsfield + video_director), `supabase/functions/chat/index.ts` (generate_video tool)

## Safety
- All additive. Existing chat/voice/integrations untouched.
- Custom keys are per-user (RLS on `custom_models`).
- Failed brains just sit unused — fallback chain protects executor.
- Video tool only fires on explicit AI call.

## Effort
One session.
