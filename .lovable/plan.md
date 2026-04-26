# Skills: Multi-format upload + Mode-gating tests

Goal: make the skill you uploaded (`SKILL.md` + `openai.yaml`) installable in Ozlon, harden the activation path so a skill can never run in a disallowed mode, and prove mode-gating works with automated tests.

---

## 1. Multi-format Skill Adapter

**New file:** `src/lib/skillAdapter.ts` (client) + mirrored logic in `supabase/functions/_shared/skills/adapter.ts` (server, used by `skills-validate`).

Accepts three input shapes and normalizes to the native `.skill.json` manifest:

| Format | How it's recognized | Mapping |
|---|---|---|
| **`.skill.json`** | Starts with `{` / parses as JSON | Pass-through (current behavior) |
| **Claude `SKILL.md`** | Starts with `---` YAML frontmatter | `name` + `description` from frontmatter; Markdown body → `instructions`; slug = kebab(name); version `1.0.0`; triggers auto-derived from description keywords; `tools_required: []` |
| **OpenAI `*.yaml`** companion | Has top-level `interface:` key | Merged into the matching `SKILL.md` skill as cosmetic fields (`display_name`, `icon`, `brand_color` stored under `manifest.ui`) |

**Trigger inference:** when no `triggers` block exists, pull 2–4 short noun phrases from the description (e.g. "marketing studio", "ad prompt", "ugc") and emit a single `keyword` trigger. Always overridable in the importer UI before install.

## 2. Importer UI upgrade

**`src/pages/SkillImport.tsx`:**
- Accept `.json`, `.md`, `.yaml`, `.yml` (and zip → unpack pairs).
- Show **detected format** badge ("Claude SKILL.md", "Native JSON", "OpenAI YAML companion").
- When a `.md` + `.yaml` pair is uploaded, auto-merge them into one preview.
- Show the normalized manifest preview before install so the user can confirm inferred slug/triggers.

## 3. Activation mode-guard (defense in depth)

`supabase/functions/chat/index.ts` already filters the **prompt index** by mode. Add a runtime guard inside the `load_skill(slug)` tool handler:

```ts
if (skill.manifest.modes_allowed?.length &&
    !skill.manifest.modes_allowed.includes(currentMode)) {
  return { error: `skill "${slug}" not allowed in ${currentMode} mode` };
}
```

Ensures a skill can never execute in a disallowed mode even if the model hallucinates a `load_skill` call.

## 4. `skills-validate` accepts raw strings

Edge function update:
- Accept `{ source: string, format?: "auto" | "json" | "md" | "yaml" }` in addition to `{ manifest }`.
- Run the adapter server-side, then run existing schema validation on the normalized output.
- Keep the same `{ valid, issues, warnings, normalized, installed }` response shape — UI changes are minimal.

## 5. Automated mode-gating tests

**`supabase/functions/_shared/skills/registry_test.ts`** — pure unit tests, no DB:
- `filterSkillsByMode` returns all skills when mode is `null`
- Skills with empty/missing `modes_allowed` are always allowed
- Skills with `modes_allowed: ["focus"]` are blocked in `idle`/`planning`/`reactive`
- Multi-mode skills (`["focus","planning"]`) allowed in both, blocked in others
- Matrix test across all 4 modes × 4 fixture skills

**`supabase/functions/skills-validate/adapter_test.ts`:**
- Native JSON pass-through preserves all fields
- Claude `SKILL.md` fixture (your uploaded one) → valid normalized manifest with inferred slug `marketing-studio-director`, version `1.0.0`, ≥1 keyword trigger
- OpenAI YAML companion merges `display_name` into `manifest.ui`
- Malformed YAML returns a clear error, never throws

Run via `supabase--test_edge_functions`.

## 6. End-to-end smoke test

After deploy:
1. Call `skills-validate` via `supabase--curl_edge_functions` with your uploaded `SKILL.md` body → expect `valid: true`.
2. Re-call with `install: true` → expect `installed.slug = "marketing-studio-director"`.
3. Confirm row appears in `public.skills` via `supabase--read_query`.
4. Verify it shows up in `/skills` UI with the icon/color from the YAML companion.

---

## Files

**New**
- `src/lib/skillAdapter.ts`
- `supabase/functions/_shared/skills/adapter.ts`
- `supabase/functions/_shared/skills/registry_test.ts`
- `supabase/functions/skills-validate/adapter_test.ts`

**Modified**
- `src/pages/SkillImport.tsx` (multi-format upload + preview)
- `supabase/functions/skills-validate/index.ts` (raw-string + adapter)
- `supabase/functions/chat/index.ts` (runtime mode-guard in `load_skill`)

## Out of scope
- Zip handling (will be follow-up if you actually need it; single-file upload covers your current case)
- Re-introducing built-in skills (kept at zero per your preference)
- Editing `.lovable/memory` index — no new persistent rules introduced

Approve to switch to default mode and ship it.
