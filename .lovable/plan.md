
User wants:
1. Add Gemini 3.x preview models to the Gauntlet
2. Add image generation tool (Nano Banana / Gemini 3 Pro Image)
3. Add image editing tool (Nano Banana 2)
4. A "plug-in area" — UI to add/configure new LLM stones from the frontend

Currently the registry is hardcoded in `_shared/model-registry.ts`. To make it truly pluggable from the UI, we need a DB-backed custom models table that merges with the static registry at request time.

Keep it tight.

# Build Plan — Expand the Gauntlet + Stone Socket

## 1. Expand the registry (Gemini 3.x + image models)
File: `supabase/functions/_shared/model-registry.ts`
- Add `google/gemini-3.1-pro-preview`, `google/gemini-3-flash-preview` to MODEL_REGISTRY (text/reasoning tier)
- Add `google/gemini-2.5-flash-image`, `google/gemini-3-pro-image-preview`, `google/gemini-3.1-flash-image-preview` with new capability `image_gen`
- Add new agent: `image_artist` → preferred `gemini-3.1-flash-image-preview`, fallback chain to other image models

## 2. Image generation + editing tools
New edge function: `supabase/functions/image-gen/index.ts`
- Accepts `{prompt, model?, inputImageUrl?}` 
- Routes via `callWithFallback('image_artist', ...)` to Lovable AI Gateway
- Returns image URL (uploaded to Supabase Storage `generated-images` bucket)
- Wire as two tools in `chat/index.ts`: `generate_image(prompt)` and `edit_image(prompt, image_url)`

New storage bucket: `generated-images` (public read)

## 3. The Stone Socket — pluggable LLM UI
This is the real "Infinity Gauntlet socket" the user is asking for.

**DB migration** — new table `custom_models`:
```
id, user_id, model_id (e.g. 'anthropic/claude-opus-4'),
display_name, gateway_url, api_key_secret_name,
context_window, cost_per_1k_in/out, capabilities text[],
fallback_model_id, enabled, created_at
```
RLS: own rows only.

**Registry merge logic** (`model-registry.ts`):
- New `loadCustomModels(supabase, userId)` fetches user's custom entries
- `pickModel()` accepts merged registry = static + custom
- `callWithFallback()` reads gateway URL from entry (defaults to Lovable AI Gateway), pulls API key from named secret if provided

**UI — extend `src/pages/ModelRouting.tsx`**
New "Stone Socket" section at bottom:
- Card list of custom models with enable toggle, edit, delete
- "Add a Stone" button → modal with form:
  - Model ID, display name, gateway URL (default: Lovable AI), capabilities multiselect, context window, cost fields, fallback dropdown
  - Optional: API key secret name (for non-Lovable gateways like Anthropic direct)
- Once added, the model appears in agent override dropdowns automatically

## 4. Settings entry already exists
"Intelligence Routing" row in Settings.tsx — no change needed, just richer page.

## Files
- New: `supabase/functions/image-gen/index.ts`, migration for `custom_models` + `generated-images` bucket
- Edited: `supabase/functions/_shared/model-registry.ts` (add models + custom merge), `supabase/functions/chat/index.ts` (image tools + image_artist agent), `src/pages/ModelRouting.tsx` (Stone Socket section)

## Safety
- All additions opt-in. Defaults unchanged.
- Custom models with no API key fall back to Lovable AI Gateway (uses `LOVABLE_API_KEY`)
- Image tools only fire when AI explicitly calls them
- RLS protects custom_models per user

## Effort
~1 session.
