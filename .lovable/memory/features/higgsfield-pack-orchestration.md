---
name: Higgsfield pack orchestration
description: 9-skill Higgsfield AI pack — orchestrator routes by intent to specialists (SOUL image, HEX color, moodboard, Sora 2, Seedance, DoP camera, Popcorn consistency, multi-scene). Tools wired via supabase/functions/_shared/integrations/higgsfield.ts (generate_image, generate_video, job_status, cancel_job).
type: feature
---

# Higgsfield AI Skill Pack

Distilled from the official Higgsfield how-to library (https://higgsfield.ai/blog/How-to-guides).

## Routing table (orchestrator)
| Intent | Slug |
|---|---|
| Static image / photodump / hero still | higgsfield-soul-image |
| Brand-color-locked image | higgsfield-hex-color |
| Custom style / aesthetic library | higgsfield-moodboard |
| Short viral video, social-first | higgsfield-sora2-video |
| Shot-structured video, transformation/orb/POV | higgsfield-seedance |
| Image→video with camera motion | higgsfield-dop-camera |
| Same character across frames | higgsfield-popcorn-consistency |
| Full multi-scene piece / instant ad | higgsfield-multi-scene |

## Memory domains
- `higgsfield.brand_visual_context` — palette HEX, character_refs, default_aspect_ratio, brand_mood, forbidden_styles, active_moodboard
- `higgsfield.character_refs.<char_name>.v1` — locked character cards (Popcorn)
- `higgsfield.moodboards.<board_name>.v1` — saved aesthetic recipes
- `higgsfield.routing_patterns` — orchestrator self-improvement (user_phrase → skill)
- `higgsfield.{soul,sora2,seedance,dop}_history` — per-model run history
- `higgsfield.multiscene_projects` — multi-scene briefs + asset URLs

## Self-improvement loop
After every sub-skill completes, the orchestrator saves a `pattern` memory in `higgsfield.routing_patterns` capturing the user phrase and routed slug. Explicit user corrections save at confidence 0.95 so they override on the next match (>0.88 similarity).

## Tools registered
`higgsfield_generate_image`, `higgsfield_generate_video`, `higgsfield_job_status`, `higgsfield_cancel_job` — all flow through the existing `higgsfield` edge function via the new manifest in `_shared/integrations/higgsfield.ts`.

## Prompting rules per model (encoded in skill instructions)
- **SOUL**: SUBJECT, SETTING, LIGHTING, LENS, MOOD, PALETTE — in that order, comma-separated.
- **SOUL HEX**: dominant 60% / secondary 30% / accents 10%; dominant HEX listed first.
- **Sora 2**: storyboard-line per shot; one camera move + one subject verb; duration in seconds.
- **Seedance 2.0**: header `[N shots, total_seconds, aspect_ratio] — FORMAT` MANDATORY on line 1.
- **DoP**: motion-only prompt; one camera move from the controlled vocabulary.
- **Popcorn**: locked Character Card appended verbatim to every prompt in a series; sequential generation only.
- **Multi-scene**: storyboard → confirm → per-beat Popcorn still → DoP animate → assembly notes.
