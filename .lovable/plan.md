## Goal

Turn Higgsfield's official how-to library into a usable skill pack inside Ozlon, so the assistant can plan and execute Higgsfield image/video generations using the techniques the Higgsfield team actually recommends (SOUL prompting, HEX color control, DoP/Sora 2/Seedance/WAN motion, Popcorn character consistency, multi-scene, instant ads).

Today there is **zero Higgsfield skill coverage** — only the `higgsfield` edge function with `generate_image`, `generate_video`, `get_job_status`, `cancel_job`. The AI can't actually call those because no integration manifest exposes them as tools. We fix both gaps.

## What we'll add

### 1. Expose Higgsfield as AI tools (one new file)
Create `supabase/functions/_shared/integrations/higgsfield.ts` (mirrors `research.ts` pattern). Tools:
- `higgsfield_generate_image` — SOUL text→image, args: prompt, aspect_ratio, resolution, optional hex_palette
- `higgsfield_generate_video` — DoP image→video, args: image_url, prompt, duration
- `higgsfield_job_status` / `higgsfield_cancel_job`

Register it in the integrations index so chat picks the tools up automatically.

### 2. Higgsfield skill pack (8 manifests in `public/sample-skills/`)

Each one encodes the prompting rules from the corresponding official guide so the AI follows Higgsfield's own playbook instead of guessing.

| Slug | Source guide | Job |
|---|---|---|
| `higgsfield-orchestrator` | index page | Triage: pick the right Higgsfield sub-skill from intent |
| `higgsfield-soul-image` | SOUL 2.0 + Photodump | High-quality stills with SOUL — composition, lighting, palette |
| `higgsfield-hex-color` | "What the HEX" guide | Brand-color image generation, palette extraction → SOUL prompt |
| `higgsfield-moodboard` | Moodboards guide | Build a custom style reference, then generate on-style images |
| `higgsfield-sora2-video` | Sora 2 prompt guide | Director-style shot list (framing, motion, timing, palette) |
| `higgsfield-seedance` | Seedance 2.0 guide | Shot-structure-first prompts (shots, duration, aspect ratio upfront), transformations / orbs / POV |
| `higgsfield-dop-camera` | WAN/DoP camera control | Image→video with cinematic camera moves + motion language |
| `higgsfield-popcorn-consistency` | Popcorn consistency guide | Character/lighting/tone consistency across multi-frame sequences |
| `higgsfield-multi-scene` | Multi-scene + Instant Ads | Stitch multiple scenes into one cohesive piece (storyboard → render → assemble) |

(That's 1 orchestrator + 8 specialists = 9 manifests.)

Each manifest follows the exact shape of the existing marketing skills (`copywriting.skill.json` style): `slug`, `name`, `version`, `description`, `triggers`, `tools_required`, `tools_optional`, `memory_domains`, `instructions` containing the actual Higgsfield prompting rules distilled from the guide.

### 3. Orchestrator behavior (`higgsfield-orchestrator`)

- Detects intent: image vs video, style vs motion vs consistency vs multi-scene.
- Calls `search_wisdom_memories` against `higgsfield.brand_visual_context` (HEX palette, character refs, brand voice). If empty, asks 3 quick questions and saves the answers via `save_memory` so future runs are one-shot.
- Routes via `load_skill(<slug>)` to the right specialist.
- After each successful generation, saves a `pattern` memory (user phrase → skill chosen → output URL) so the orchestrator improves over time — same self-improvement loop the marketing-orchestrator uses.

### 4. Memory domain
New domain: `higgsfield.brand_visual_context` storing HEX palette, character reference image URLs, default aspect ratio, brand mood adjectives, forbidden styles. Used by every sub-skill.

### 5. Seed migration
One idempotent SQL migration to insert all 9 skills into `public.skills` with `source='builtin'`, `visibility='public'` — same pattern as the marketing pack seed.

### 6. Memory file
`.lovable/memory/features/higgsfield-pack-orchestration.md` documenting routing table + prompting rules per model, + index.md update.

## What we will NOT do
- No UI changes.
- No edits to the existing `higgsfield` edge function (it already has the actions we need).
- No new sample integrations beyond Higgsfield.
- No automatic credit/spend changes.

## Files touched

**New (11):**
- `supabase/functions/_shared/integrations/higgsfield.ts`
- `public/sample-skills/higgsfield-orchestrator.skill.json`
- `public/sample-skills/higgsfield-soul-image.skill.json`
- `public/sample-skills/higgsfield-hex-color.skill.json`
- `public/sample-skills/higgsfield-moodboard.skill.json`
- `public/sample-skills/higgsfield-sora2-video.skill.json`
- `public/sample-skills/higgsfield-seedance.skill.json`
- `public/sample-skills/higgsfield-dop-camera.skill.json`
- `public/sample-skills/higgsfield-popcorn-consistency.skill.json`
- `public/sample-skills/higgsfield-multi-scene.skill.json`
- `supabase/migrations/<ts>_seed_higgsfield_skills_pack.sql`

**Edited (3):**
- Integrations index (to register the new manifest)
- `.lovable/memory/index.md`
- `.lovable/memory/features/higgsfield-pack-orchestration.md` (new)

Approve and I'll ship it.

---

## Status: SHIPPED (2026-05-01T19:23:03Z)

- 9 Higgsfield skill manifests in public/sample-skills/
- supabase/functions/_shared/integrations/higgsfield.ts (4 tools) registered in index.ts
- supabase/migrations/20260501192228_seed_higgsfield_skills_pack.sql (idempotent, ON CONFLICT update)
- .lovable/memory/features/higgsfield-pack-orchestration.md + index.md updated

The migration deploys to Cloud automatically; no UI changes required.
