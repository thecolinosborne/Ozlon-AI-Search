## Goal
Get the user's uploaded `marketing-studio-director.skill.json` (extracted from the zip) successfully validated, installed into the catalog, and verified end-to-end with the live mode-gating logic.

## Findings from inspecting the upload

The zip contains a single file: `marketing-studio-director.skill.json`. Three issues will block install as-is:

1. **Trigger schema mismatch.** The author wrote `{ "type": "keyword", "value": "Marketing Studio" }`, but our validator (`skills-validate/index.ts` lines 66–71) requires `{ "type": "keyword", "match": ["..."] }`. Every one of the 16 triggers will fail.
2. **`presentation` block uses the wrong key.** Our adapter merges UI metadata under `ui`, not `presentation`. Cosmetic only — won't block install, but the icon/brand color won't surface.
3. **`instructions` is exactly 10,000 chars and ends mid-sentence** (`"...the avatar must match exac"`). It just barely passes the `> 10000` cap but is clearly truncated by the author. We'll keep it as-is and surface a warning.

The importer also doesn't accept `.zip` — the user already extracted via the upload, so we'll process the `.skill.json` directly.

## Plan

### 1. Auto-heal common manifest mistakes in the adapter (additive, surgical)
File: `supabase/functions/_shared/skills/adapter.ts`

Add a `normalizeNativeManifest()` helper that runs when `detectFormat === "json"`:
- Coerce `triggers[i].value` (string) → `triggers[i].match` (string[]) for keyword triggers. Coerce single-string `match` → `[match]`.
- Coerce top-level `presentation` → `ui` (merged, doesn't overwrite an existing `ui`).
- Leave everything else untouched.

This makes the importer tolerant of the two most common authoring mistakes (Claude/OpenAI-style YAML uses `value`; some templates use `presentation`) without weakening validation.

### 2. Add a focused adapter test
File: `supabase/functions/skills-validate/adapter_test.ts` (extend existing)

- Test: native JSON with `value`-style keyword triggers gets normalized to `match[]` and passes validation.
- Test: `presentation` is moved under `ui`.

### 3. Copy the extracted skill into the project as a fixture
File: `public/sample-skills/marketing-studio-director.skill.json`

Place a clean copy so the user (and future tests) can re-import it from the importer's "Use sample" picker if we ever extend it.

### 4. Add `modes_allowed` to the manifest before install (recommendation only)
The uploaded file omits `modes_allowed`, which means our gating treats it as "available in every mode" (per current registry behavior). For mode-gating tests to be meaningful, we'll suggest the user pick — but for this upload pass we will install it as-is (open to all modes) since omitting `modes_allowed` is valid per schema.

### 5. Deploy + install the skill via the existing endpoint
- `supabase--deploy_edge_functions` for `skills-validate`.
- `supabase--curl_edge_functions` to POST the file content with `install: true`. Confirm a row appears in `skills` with `source: "imported"`.

### 6. End-to-end mode-gating verification (the actual test the user asked for)
- `supabase--test_edge_functions` to run the existing `registry_test.ts` and `adapter_test.ts` (plus the new adapter normalization test) — confirm pass.
- `supabase--read_query` to verify the new `skills` row exists and the manifest looks normalized (triggers are `match[]`, `ui` block present).
- `supabase--curl_edge_functions` against `chat` with a probe message containing one of the trigger keywords ("create a UGC ad for Ozlon"). Confirm the system prompt route surfaces the skill and that, when we set `current_mode = focus` with a skill scoped to `planning` only (using the existing `morning-briefing` builtin as control), the gate blocks it. This proves both **block** and **allow** paths fire correctly.
- Capture the responses and report what was allowed/blocked under each mode.

### 7. Report back to the user
Summarize:
- Skill installed: yes/no, with id/slug.
- Adapter auto-heals applied (so they know what we changed silently).
- Mode-gating matrix actually exercised against the live `chat` function.
- Note that the source `instructions` are author-truncated at 10k chars and offer to re-import a fuller version if they have one.

## Out of scope (not doing this pass)
- Adding zip-upload support to the importer UI (separate UX feature).
- Re-writing the truncated instructions — we don't know what was clipped.
- Adding `modes_allowed` to the manifest on the user's behalf.