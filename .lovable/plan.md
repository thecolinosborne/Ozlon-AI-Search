

## What you're seeing & why

### "Get a free key" explained
On the **Intelligence Routing** page (`/settings/routing` → `ModelRouting.tsx`), each provider has a small `Get a free key ↗` link. It's just a courtesy outbound link to the provider's API console (e.g., `platform.openai.com/api-keys`, `aistudio.google.com/apikey`) where new users can sign up and grab a developer key. Gemini's tier is genuinely free up to a daily quota; OpenAI and Anthropic call it "free signup" but charge per-token after credits. The wording is misleading — we'll change it to **"Where to get a key ↗"**.

### Why OpenAI & Gemini look "not synced"
They actually *are* synced — the keys exist as **server-side secrets** (`OPENAI_API_KEY`, `GEMINI_API_KEY`), which is why the Gauntlet shows them as **active stones**. But there's no visual that says "this stone is powered by a project-level key, not a user-level key." So it looks like a dead input. Two separate concepts are colliding:

- **Project-wide stones** (powered by secrets you've added) — always on for everyone, no input needed
- **Bring-your-own-key stones** (the `/settings/routing` form) — per-user keys stored in the vault

We'll make this visually obvious with a **"Powered by system key"** badge on the stone, plus a small "Replace key" affordance for admins.

### The two-routing-pages problem
Right now:
- `/settings/routing` → old `ModelRouting` page (BYOK key entry, "Get a free key" links)
- `/integrations/ai-processor` → new `GauntletPanel` (Auto router, stone slots, telemetry)

Same domain, two pages, confusing. We unify under one concept you named: **The Brain**.

---

## The Brain — naming & IA

| Old name | New name |
|---|---|
| Intelligence Routing (Settings) | **The Brain** |
| Model Router | **Brain Stones** |
| AI Processor (Integrations) | *(removed — folded into The Brain)* |
| Higgsfield (Integrations) | *(removed — becomes a Brain Stone for image/video)* |
| Settings → Intelligence Routing row | Settings → **The Brain** |

**Concept:** The Brain is one mind. Stones are its lobes — each lobe handles what it's best at (reasoning, vision, image, video). The system picks the right lobe for the moment. You can swap lobes in and out.

Tagline under the header: *"One mind. Many lobes. Auto-tuned to the moment."*

---

## Build (additive, surgical)

### 1. Unify routing under `/settings/brain`
- Rename route `/settings/routing` → `/settings/brain` (keep old route as redirect for safety)
- `ModelRouting.tsx` → `Brain.tsx` (file rename + header + copy update)
- The page becomes a single screen with three sections:
  1. **Auto Mode** toggle (from GauntletPanel)
  2. **Brain Stones** grid — every stone (system + BYOK) shown together
  3. **Usage Breakdown** chart (from GauntletPanel)

### 2. Stone source clarity
Each `StoneSlot` gets a source badge:
- 🟣 **System Stone** — powered by project-level key, always-on, no input
- 🔵 **Personal Stone** — your BYOK key, replaceable
- ⚪ **Available** — not yet activated, click to add a key

For System Stones, replace the dead-looking input with:
> ✓ Powered by system key · Last verified 2 min ago
> [Replace with my own key →] (collapsed by default)

### 3. Add Higgsfield as a Brain Stone
- Add `higgsfield` to `STONES` matrix in `gauntlet-router/index.ts`:
  - capabilities: `{ image: 9, video: 10, reasoning: 0, vision: 0, speed: 6, cost: 2 }`
  - Add `video` modality to the `Needs` type and scoring function
- Add Higgsfield driver (`callHiggsfield`) that wraps existing `higgsfield` edge function
- Auto-route: image_gen requests can pick between Lovable Gemini (free, fast) and Higgsfield (premium, video-capable); video_gen requests go to Higgsfield first
- Remove Higgsfield card from `/integrations` page
- Keep `/integrations/higgsfield` route alive but redirect to `/settings/brain` with stone highlighted

### 4. Copy fixes
- "Get a free key" → "Where to get a key" (it's not always free)
- Add tooltip on the link: *"Some providers offer free tiers (Gemini), others charge per-token after signup."*
- Add bottom-of-page note:
  > **Not yet supported:** Anthropic Claude, Groq, Mistral, DeepSeek. We'll add these as Brain Stones when there's demand.

### 5. Settings page update
- Rename "Intelligence Routing" section → "The Brain"
- Rename "Model Router" row → "Brain Stones"
- Update icon from `Zap` → `Brain` (lucide)
- Update description: *"Stones picked automatically. Swap lobes anytime."*

---

## Files touched

**Modified (additive, no deletions):**
- `src/pages/ModelRouting.tsx` — rename copy, update "Get a free key" wording, add System/Personal stone badges, embed GauntletPanel sections
- `src/pages/Settings.tsx` — rename section + row labels, swap icon
- `src/pages/Integrations.tsx` — remove Higgsfield from list array
- `src/App.tsx` — add `/settings/brain` route (alias to existing page), add redirect for `/integrations/higgsfield` → `/settings/brain?stone=higgsfield`
- `src/components/gauntlet/StoneSlot.tsx` — add source badge ("System Stone" / "Personal Stone")
- `src/components/gauntlet/GauntletPanel.tsx` — add bottom note about unsupported providers
- `src/hooks/useGauntlet.ts` — add `higgsfield` to `ALL_STONES`, add `source: 'system'|'personal'` field
- `supabase/functions/gauntlet-router/index.ts` — add Higgsfield stone + driver + `video` modality scoring
- `src/pages/integrations/AIProcessorDetail.tsx` — keep page alive but show banner: *"Moved to Settings → The Brain"* with redirect button

**Untouched:**
- `/integrations/higgsfield` detail page stays accessible (for advanced API key management) but de-emphasized
- All chat tools, voice, onboarding, auth
- The 17-item verification checklist still applies

---

## What this fixes
1. ✅ "Get a free key" mystery — relabeled + tooltipped
2. ✅ OpenAI/Gemini look unsynced — now shows "System Stone · Powered by system key"
3. ✅ Higgsfield no longer clutters Integrations — becomes a real Brain Stone for image/video
4. ✅ Two routing pages collapse into one — **The Brain** at `/settings/brain`
5. ✅ Naming feels productized + human (Brain / Stones / Lobes metaphor consistent)
6. ✅ Anthropic/Groq/Mistral/DeepSeek noted as "not yet" — no false promises

Approve and I execute.

