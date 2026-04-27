## GoHighLevel Custom Fields — Full Skill Family

Today Ozlon can only hit one half-wired endpoint (`list_custom_fields`) and it isn't even registered as an AI tool. This plan ships the complete field-management skill family the user described, with duplicate-safety, verbatim error surfacing, and the standard active-sub-account resolution.

### What gets built

**6 new AI tools** (registered in the GHL manifest so the chat agent can call them):

| Tool | Verb | Notes |
|---|---|---|
| `ghl_list_custom_fields` | read | Filter by `objectType` (contact / opportunity / business). Wires up the orphan endpoint. |
| `ghl_get_custom_field` | read | Fetch one field by ID for audit/confirmation. |
| `ghl_create_custom_field` | write | Full payload: name, dataType, placeholder, options, defaultValue, position, parentId (folder), objectType. |
| `ghl_update_custom_field` | write | Rename, edit options, placeholder, position. |
| `ghl_upsert_custom_field` | write | Lists first → matches by normalized key/name → creates or updates. Best DX for repeatable workflows. |
| `ghl_archive_custom_field` | destructive | Archive-first. GHL only supports hard delete via API, so this performs a delete and labels it as archive in the receipt + requires confirmation. |

**Supported field types** (GHL `dataType` values): TEXT, LARGE_TEXT (textarea), NUMERICAL, PHONE, DATE, SINGLE_OPTIONS (dropdown), MULTIPLE_OPTIONS, RADIO, CHECKBOX, MONETORY (GHL's spelling). The schema accepts a friendly alias map (`textarea` → `LARGE_TEXT`, `dropdown` → `SINGLE_OPTIONS`, `monetary` → `MONETORY`) so the AI can pass natural names.

**Option-based fields** accept an `options` array of `{ label, value?, position? }`. If `value` is omitted we auto-derive it from the label (lowercase, snake_case). `defaultValue` and `placeholder` pass through.

### Skill behavior (built into the create + upsert tools)

1. **Resolve active sub-account** — already handled by the existing 4-step priority (explicit → session → user default → metadata). No change needed.
2. **Auto-suggest normalized key** — if `fieldKey` is omitted, derive from name: lowercase, replace non-alphanumerics with `_`, collapse repeats, strip leading/trailing `_`. Pass as `fieldKey` to GHL.
3. **Duplicate detection** — `create` and `upsert` first fetch the existing field list for the target `objectType` and check for name + key collisions.
   - `create`: returns a structured `duplicate_exists` error with the existing field ID so the AI can ask the user whether to update or create a variant. (No silent overwrite.)
   - `upsert`: matches → calls update; no match → calls create.
4. **Return receipt** — `{ id, name, fieldKey, dataType, objectType, optionsCount }`.

### Error surfacing (the user's "fallback behavior" requirement)

The edge function currently swallows GHL errors into a generic message. We update the GHL receiver to return a structured error block on any non-2xx GHL response:

```json
{
  "ok": false,
  "error": {
    "category": "schema_gap | auth_gap | service_not_connected | policy_block | tooling_gap | upstream_error",
    "ghl_status": 422,
    "ghl_message": "<verbatim body from GHL>",
    "minimum_fix": "<one-line hint based on category>"
  }
}
```

Category mapping: 401/403 → `auth_gap`; 404 on the field endpoint → `schema_gap`; missing connection → `service_not_connected`; 422/400 with validation body → `schema_gap`; 429 → `policy_block`; 5xx → `upstream_error`. Anything else → `tooling_gap`. This matches the existing `chat/error-reporting-policy` memory ("never swallow errors, return detailed structured errors").

### Files touched

- `supabase/functions/gohighlevel/index.ts` — add cases for `get_custom_field`, `create_custom_field`, `update_custom_field`, `delete_custom_field`; tighten the existing `list_custom_fields` to accept `objectType` query param; add the structured error wrapper for non-2xx GHL responses.
- `supabase/functions/_shared/integrations/gohighlevel.ts` — register all 6 tools with schemas, formatters, `mapArgs`, alias normalization, and `requiresConfirmation: true` on archive.
- New helper inside the manifest file: `normalizeDataType()`, `deriveFieldKey()`, `normalizeOptions()`.

### Out of scope (explicitly)

- No UI surface for managing fields (the user asked for AI tooling, not a visual field editor). Fields will be created/edited via chat and the existing GHL admin UI.
- No new memory file — the existing `mem://integrations/ghl-account-resolution` and `mem://chat/error-reporting-policy` cover the patterns this skill family follows.
- No `ghl_get_custom_field` formatter beyond the default JSON dump (audit use case is intentionally raw).

### Acceptance check

After deploy, the AI should be able to handle, end-to-end:
- "List all custom fields on contacts in GHL"
- "Create a dropdown field called Lead Source on contacts with options Referral, Paid Ads, Organic"
- "Rename the Lead Source field to Acquisition Channel"
- "Make sure there's a contact field called Last NPS Score (number) — create or update as needed" (upsert)
- A duplicate-name attempt returns a clean `duplicate_exists` error with the existing field ID, and the AI asks the user how to proceed instead of failing silently.
