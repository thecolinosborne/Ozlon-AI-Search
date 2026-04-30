# Skill Editing Tools — Plan

## Goal
Close the capability gap surfaced by the AI's report: there's currently no tool to update an installed skill's instructions or prerequisites. Today, the AI either improvises or saves "remember to apply X" memories. We'll give it first-class skill-editing tools that produce a new versioned skill record, audited via `skill_snapshots`.

## Design Principles
- **Versioned, not destructive.** Every edit bumps `version` and writes a `skill_snapshots` row (we already have this table from Phase A).
- **Scoped to ownership.** Users can only patch skills they authored OR private forks of imported/builtin skills. Editing a builtin/imported skill auto-creates a user-owned fork instead of mutating the original.
- **Re-scanned every edit.** The same Ozlon compatibility scan from `_shared/skills/scan.ts` runs on the patched manifest before save — same safety bar as ingestion.
- **AI-callable + UI-callable.** Same edge function backs both a chat tool and a future "Edit skill" UI.

## Deliverables

### 1. New edge function: `supabase/functions/skills-edit/index.ts`
Single endpoint, three operations (chosen via `op` field):

- `op: "append_prerequisites"` — `{ slug, prerequisites: string[] }`
  Appends a "## Prerequisites" section (or merges into existing one) at the top of `manifest.instructions`.
- `op: "patch_instructions"` — `{ slug, mode: "append" | "prepend" | "replace_section", section?: string, content: string }`
  Free-form instruction patches. `replace_section` looks for `## {section}` headers; falls back to append if not found.
- `op: "update_manifest"` — `{ slug, patch: Partial<SkillManifest> }`
  Whitelist-merged patch for `description`, `triggers`, `tools_required`, `tools_optional`, `memory_domains`, `modes_allowed`, `requires_confirmation`. Slug/version/side_effect locked.

Flow for every op:
1. Auth user via JWT.
2. Load skill by slug (must be installed by user OR authored by user).
3. If `source !== "user"` OR `author_user_id !== user.id` → **fork**: clone into a new `skills` row with `source = "user"`, `author_user_id = user.id`, `visibility = "private"`, slug suffixed `-mine` if collision, then re-point the user's `skill_install` to the fork.
4. Apply patch → produce new manifest.
5. Bump `version` (semver patch increment).
6. Run `scanSkill()` — abort with structured error if scan fails.
7. Update `skills` row, write `skill_snapshots` row with `{ before, after, op, actor }`.
8. Return `{ slug, version, effective_instructions_summary, scan_summary }`.

### 2. Wire two AI tools in `supabase/functions/chat/index.ts`
Next to the existing `load_skill` block (~line 7189):

- `update_skill` — generic patcher mapping to `patch_instructions` / `update_manifest`.
- `add_skill_prerequisites` — convenience tool mapping to `append_prerequisites` (matches the AI's requested signature).

Both call `skills-edit` via internal fetch with the user's auth header (same pattern as other authenticated tool calls). Results are returned as structured JSON the AI can summarize.

### 3. UI affordance (minimal)
Add an "Edit" button on installed skill cards in `src/pages/Skills.tsx` that opens a lightweight dialog reusing `SkillBuilder`'s textarea — POSTs to `skills-edit` with `op: "patch_instructions"`. Out of scope for v1: full visual section editor.

### 4. No DB migration needed
`skill_snapshots` already exists from Phase A. We'll just add an `op` column via a small migration: `ALTER TABLE skill_snapshots ADD COLUMN op text` (nullable, default null) so we can distinguish ingest vs edit events.

## Technical Notes
- Forking logic is the most subtle piece: builtin/imported skills are shared catalog entries. We MUST never mutate them. The fork creates a private copy and re-binds the install in a single transaction.
- `effective_instructions_summary` returned to the AI is the first 600 chars of the new instructions — enough for the AI to confirm the patch landed without re-loading.
- Scan failures return `{ success: false, scan_issues: [...] }` so the AI gets a structured error per the existing error-reporting policy (no swallowing).
- Memory rule for the Higgsfield prerequisites stays in place as belt-and-suspenders, but the AI should prefer `add_skill_prerequisites` going forward.

## Files Touched
- **new** `supabase/functions/skills-edit/index.ts`
- **new** `supabase/migrations/<ts>_skill_snapshots_op.sql`
- **edit** `supabase/functions/chat/index.ts` — register two new tools + dispatcher routes
- **edit** `supabase/functions/_shared/skills/registry.ts` — add `forkSkillForUser()` + `applyManifestPatch()` helpers
- **edit** `src/pages/Skills.tsx` — add Edit button + dialog
- **new** `src/components/skills/SkillEditDialog.tsx`

## After Approval
Once you say go, I'll build it, deploy `skills-edit` + redeploy `chat`, and you'll be able to say things like *"add these prerequisites to the Higgsfield skill: …"* and the AI will patch the skill directly with a versioned, audited update.
