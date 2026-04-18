
User wants the Brain page restructured:

1. **Connected Brains** = only platforms where the user has actually plugged in a key (or are auto-connected via Lovable AI Gateway). Each card represents the **whole platform** (Gemini, OpenAI, Higgsfield, Anthropic, xAI, Mistral, DeepSeek) — NOT broken out by individual model (no separate Veo, Nano Banana, GPT-5 cards).
2. Each connected platform card lists what it powers in plain English (e.g. Gemini → "Text · Image · Video", OpenAI → "Text · Tools · Voice", Higgsfield → "Image · Video").
3. **Disconnect** button on each card — like removing a stone from the Gauntlet. Removes the key + custom_models row, platform falls back through router.
4. **Add a Brain** = catalog of platforms NOT yet connected. Paste API key → platform jumps to Connected Brains section, all its capabilities (text/image/video) light up across the Infinity Router automatically.
5. Drop per-model granularity in the UI. Platform-level only.

Currently `connect-brain/index.ts` only knows xai/anthropic/mistral/deepseek and inserts ONE custom_models row per provider. To make a platform connection light up multiple capabilities (e.g. Gemini key → text + image + video), the connect action needs to insert **multiple** custom_models rows under one platform key, and disconnect needs to remove them all.

Plan is clear. Concise version below.

# Plan — Platform-level Brain Gauntlet

## 1. Restructure `connect-brain` edge function
Refactor PRESETS into **platform presets**. Each platform = one API key + N model rows.

Platforms:
- `gemini` (Google) → key powers `google/gemini-2.5-pro`, `google/gemini-2.5-flash`, `google/gemini-3-pro-image-preview`, `google/veo-3-fast`
- `openai` → `openai/gpt-5`, `openai/gpt-5-mini`, `openai/gpt-5-nano`
- `anthropic` → `anthropic/claude-opus-4`, `anthropic/claude-sonnet-4`
- `xai` → `xai/grok-4`
- `mistral` → `mistral/mistral-large-latest`
- `deepseek` → `deepseek/deepseek-chat`
- `higgsfield` → `higgsfield/dop-standard`, `higgsfield/image-soul` (special: stored in integration_connections, not custom_models — already wired)

Actions:
- `action: "connect"` → upserts ALL model rows for that platform with same `inline:<key>` and a shared `metadata.platform_id` tag for grouping
- `action: "disconnect"` → deletes all custom_models rows where `metadata.platform_id = <platform>` (and for higgsfield, marks integration_connections disconnected)
- `action: "list_status"` → returns `{ platform, connected, last4, capabilities[] }[]` — auto-detected from custom_models + integration_connections + Lovable AI baseline (gemini + openai always shown as "Connected via Lovable AI" if no user key present)

Migration: add `metadata jsonb` column to `custom_models` (or reuse existing fields — check schema). custom_models has no metadata column → add one.

## 2. Rewrite Brain page UI (`src/pages/ModelRouting.tsx`)

**Section A — Connected Brains** (Gauntlet-style)
One card per platform with:
- Platform name + logo glyph
- Capability pills: Text · Image · Video · Voice · Tools (only those it provides)
- Status: "Connected via your key ••••1a2b" OR "Connected via Lovable AI"
- Disconnect button (only if user-keyed; Lovable AI baseline can't be disconnected)

**Section B — Add a Brain**
Cards for every platform NOT in Connected Brains. Each:
- Platform name + capability pills (greyed)
- Inline API key input + Connect button
- On Connect → calls `connect-brain` → platform card animates over to Section A → all its capabilities join the Infinity Router immediately

**Section C — What handles what?** (keep, simplified)
Plain-English roles, dropdown shows only models from currently-connected platforms + Auto.

**Section D — How it's been performing** (keep telemetry as-is)

Removed from current page: per-model breakouts, Veo/Nano Banana as separate cards, anything technical.

## 3. Backend wiring
- `mergeRegistry` already picks up custom_models rows → no changes needed in chat function
- Disconnect just removes rows → router falls back automatically
- Lovable AI baseline (gemini + openai via LOVABLE_API_KEY) stays as the default when no user key present — already how `MODEL_REGISTRY` works

## Files
- Edited: `supabase/functions/connect-brain/index.ts` (platform presets + disconnect + list_status), `src/pages/ModelRouting.tsx` (full UI rewrite, same route)
- Migration: add `metadata jsonb default '{}'` to `custom_models` for platform grouping

## Safety
- All additive. Lovable AI baseline untouched — disconnecting a user key just reverts that platform to baseline (or removes it if no baseline exists).
- RLS already protects custom_models per user.
- One session.
