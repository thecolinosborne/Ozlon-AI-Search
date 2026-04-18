
User wants the Brain page to feel less like a developer console and more like a consumer product. Combine the polish plan with consumer-friendly framing. Keep it tight.

# Plan — Make Brain feel like a product

## 1. Language overhaul (no jargon)
Rename in UI only — backend unchanged:
- "Connected Brains" → **"Your Brains"**
- "Add a Brain" → **"Add another Brain"** with subtitle "Bring your own keys to unlock more power"
- "What handles what?" → **"How your Brains work together"**
- "How it's been performing" → **"This week's activity"**
- Capability pills: `text` → "Conversation", `tools` → "Actions", `vision` → "Sees images", `image_gen` → "Creates images", `video_gen` → "Creates videos", `voice` → "Speaks & listens", `reasoning` → "Deep thinking", `long_context` → "Remembers a lot"
- Tier labels: `pro` → "Premium", `flash` → "Fast", `nano` → "Lightweight" (only show if user expands)

## 2. Friendlier Add-a-Brain cards
Each disconnected platform card:
- Provider logo glyph (use lucide icons: Sparkles, Bot, Brain, Zap, etc. — no real logos to avoid trademark)
- One-sentence description in human terms (e.g. Gemini → "Google's brain. Great at images, video, and reading long documents.")
- "Get a free key →" link to the right console (aistudio.google.com etc.) — opens in new tab
- Single input with smart placeholder showing prefix shape (`AIza…`, `sk-…`, etc.)
- Optional "Nickname this brain" field underneath (e.g. "Personal", "Work") — stored in `metadata.label`
- Big friendly **"Plug it in"** button (instead of "Connect")
- Soft helper text on focus: "We store this securely. Only you can see it."

## 3. Friendlier Connected Brain cards
- Show nickname if set, else platform name
- Status line: "Powering: Conversation · Images · Video" (humanized capabilities, comma-joined)
- Source line: "Using your key ••••1a2b" or "Powered by Ozlon" (instead of "Lovable AI baseline")
- "Manage at [console] ↗" small link
- Disconnect button styled as soft ghost text "Remove from Gauntlet" with confirm dialog ("This brain will stop powering Ozlon. You can plug it back in anytime.")

## 4. Empty/first-run polish
If user has zero personal brains:
- Hero line at top: **"Ozlon runs on multiple AI brains. Add your own to unlock more, faster, and cheaper."**
- Subtle "Recommended first" badge on Gemini card (free tier is generous)

## 5. Light validation feedback
- After paste, show green check if prefix matches expected shape, soft amber hint if not ("This doesn't look like a Gemini key — double-check?") — never block submit

## 6. Skip for now (revisit later)
- Per-response provider attribution badge in chat
- Usage/cost dashboard
- `extra_fields` scaffolding for Vertex/Azure/Bedrock
Reason: ship the consumer feel first, layer power-user features later.

## Files
- Edited: `src/pages/ModelRouting.tsx` — language, layout, nickname input, validation, confirm dialog, hero line, recommended badge
- Edited: `supabase/functions/connect-brain/index.ts` — add `console_url`, `key_prefix`, `human_blurb`, `humanized_capabilities` to each PLATFORM preset; accept optional `label` on connect; return these fields in `list_status`/`list_presets`

## Safety
Pure UI/copy + additive backend fields. No schema change (label rides inside existing `metadata` jsonb). Existing connections keep working untouched.

## Effort
One session.
