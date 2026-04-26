# Ozlon Skills Platform — Formal Build Plan

A "skill" is a scoped instruction packet that composes existing tools, scopes its own memory, defines triggers, and follows safety tiers. Skills are progressively loaded so 100+ can be installed without prompt bloat.

---

## Phase S1 — Foundation (schema + manifest + loader)

**Database (migration)**
- `public.skills` — catalog: `id, slug, name, description, version, manifest jsonb, source ('builtin'|'user'|'imported'), author_user_id, visibility ('private'|'org'|'public'), trust_tier (0|1|2), created_at`
- `public.skill_installs` — per-user state: `user_id, skill_id, enabled, config jsonb, installed_at, last_used_at`
- `public.skill_invocations` — audit: `id, user_id, skill_id, trigger_type, trigger_payload jsonb, tools_called jsonb, outcome ('success'|'partial'|'error'), reflection_id, created_at`
- RLS: users read/write only their own installs + invocations; `skills` readable when `visibility='public'` OR `author_user_id = auth.uid()` OR `source='builtin'`

**Manifest format (`.skill.json`)**
```json
{
  "slug": "email-triage",
  "name": "Email Triage",
  "description": "Sort inbox into act/read/archive buckets",
  "version": "1.0.0",
  "triggers": [
    { "type": "keyword", "match": ["clean inbox", "triage email"] },
    { "type": "intent", "match": "CHECK_MAIL" },
    { "type": "signal", "match": "vip_unread_threshold" }
  ],
  "tools_required": ["gmail_list", "gmail_get", "gmail_modify_labels"],
  "tools_optional": ["save_memory"],
  "memory_domains": ["email", "communication-style"],
  "modes_allowed": ["idle", "planning", "reactive"],
  "instructions": "Step-by-step prompt the AI loads when triggered…",
  "side_effect": "write",
  "requires_confirmation": true
}
```

**Edge function — progressive loader**
- New `supabase/functions/_shared/skills/registry.ts` — loads installed skills for a user, returns 1-line index entries
- New tool `load_skill(slug)` registered in `chat/index.ts` — when invoked, returns full `instructions` + activates `tools_required` for the remaining turns
- System prompt injection: "Installed skills:\n- email-triage: sort inbox into act/read/archive\n- weekly-review: …" (one line each)

**Files added**
- `supabase/migrations/<ts>_skills_platform.sql`
- `supabase/functions/_shared/skills/types.ts`
- `supabase/functions/_shared/skills/registry.ts`
- `supabase/functions/_shared/skills/loader.ts`
- patch `supabase/functions/chat/index.ts` (skill index + `load_skill` tool)

---

## Phase S2 — Marketplace UI + Seed Pack

**Frontend**
- `/skills` route — list installed + browse public; toggle enable/disable; per-skill config drawer
- `src/pages/Skills.tsx`, `src/components/skills/SkillCard.tsx`, `src/components/skills/SkillDetail.tsx`
- `src/hooks/useSkills.ts` — list/install/toggle via supabase client
- BottomNav / sidebar entry under existing nav (additive — no redesign)

**Seed skills** (insert as `source='builtin'`)
1. Email Triage
2. Weekly Review
3. Meeting Prep
4. Cold Outreach
5. Content Repurposer

Each ships as a `.skill.json` in `supabase/functions/_shared/skills/builtin/` and is upserted on edge boot.

---

## Phase S3 — Authoring

- `/skills/new` — visual builder: pick name, triggers, tools (from `TOOL_REGISTRY`), memory domains, write instructions
- Live preview of generated `.skill.json`
- Export/download manifest
- `src/pages/SkillBuilder.tsx`, `src/components/skills/SkillToolPicker.tsx`

---

## Phase S4 — Importer + Validator (proprietary `.skill.json` only — NOT Claude format)

Per user direction: this is **Ozlon's own skill format**, not a Claude-import compatibility layer.

- `/skills/import` — paste JSON or upload `.skill.json`
- Validator pipeline (edge function `skills-validate`):
  1. JSON schema check
  2. Tool-existence check against `TOOL_REGISTRY`
  3. Trust-tier assignment (imported = Tier 2, read-only by default)
  4. Dry-run sandbox: execute instructions with mocked tool responses, verify completion
- Result UI: ✅ ready / ⚠️ partial (missing tools listed) / ❌ rejected (with reasons)

---

## Phase S5 — Engine Fusion

- **Wisdom Engine**: when a skill runs, scope `match_wisdom_memories` queries by `memory_domains`; write outcome as `reflection_note` with `metadata.skill_id`. Promote recurring patterns to `skill_pattern` memory type.
- **Signals**: extend `signal_moments.suggested_direction` to optionally carry `{ skill_slug, params }`. Acting on a signal can directly invoke `load_skill`.
- **Modes** (`useCurrentMode`): loader filters skills by `modes_allowed` so focus mode never fires reactive skills.
- **Chat UI**: small "skill chip" in `MessageBubble` when a skill is active (e.g., "🎯 Email Triage").

---

## Out of scope (explicitly)
- Claude `SKILL.md` import (user rejected)
- Public marketplace publishing flow (private + builtin only at launch; revisit later)
- Arbitrary new edge-function endpoints from skill authors (compose-only for safety)

---

## Order of execution
S1 → S2 (with seed pack) → S3 → S4 → S5. Each phase ships independently and is additive. No existing UI is restructured.