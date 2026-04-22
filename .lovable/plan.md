
## Orchestration hardening plan — make it work across the whole callable backend

### What will be fixed
The orchestration layer currently fails closed:
- `chat/index.ts` validates only `ACTION_TOOLS` at `getValidatedTools()` and then appends registry tools afterward, so manifest tools bypass the guard entirely.
- One malformed tool schema (`google-sheets`) can still poison the whole OpenAI tool payload.
- Callable edge functions are split between legacy switch logic and the manifest registry, so the orchestration surface is incomplete and inconsistent.
- Multi-tool execution exists (`multi_action` + `dispatchMulti`) but lacks a unified health/validation layer across all callable functions.

---

## Implementation

### 1) Immediate recovery: stop one bad tool from breaking Gmail or anything else
**Files**
- `supabase/functions/_shared/integrations/google-sheets.ts`
- `supabase/functions/chat/index.ts`

**Changes**
- Fix the malformed 2D-array schemas in `sheets_write_range` and `sheets_append_rows`.
- Replace the current shallow `isValidToolSchema()` with a recursive JSON-schema validator.
- Move validation to the **final assembled tool list** after legacy tools, manifest tools, and `multi_action` are all merged.
- Quarantine invalid tools individually instead of failing the whole request.

**Result**
One broken tool gets dropped. The other tools still load and run.

---

### 2) Unify orchestration so it covers all AI-callable edge functions
**Files**
- `supabase/functions/_shared/integrations/index.ts`
- `supabase/functions/_shared/integrations/types.ts`
- new manifest files under `supabase/functions/_shared/integrations/`
- `supabase/functions/chat/index.ts`

**Changes**
- Treat the manifest registry as the single orchestration entrypoint for every **AI-callable** edge function.
- Add manifests for callable functions that are still outside the registry today, including the communications/knowledge/media-style functions that should be available to the orchestrator.
- Keep webhook/internal lifecycle functions out of the callable surface (`slack-events`, `slack-oauth`, scheduled/background-only handlers, etc.) so “all edge functions” becomes “all callable edge functions,” which is the scalable boundary.

**Result**
The orchestrator stops depending on a half-registry / half-switch model.

---

### 3) Normalize every orchestrated function to one response contract
**Files**
- new shared helper, e.g. `supabase/functions/_shared/tool-response.ts`
- callable edge functions that currently vary in shape
- `supabase/functions/_shared/integrations/_dispatcher.ts`

**Changes**
- Standardize success/error envelopes to a single normalized contract:
  - success path
  - error path
  - structured diagnostics
- Make the dispatcher accept both old and new envelopes during transition, but always normalize what it returns to the AI.
- Preserve detailed provider errors instead of collapsing them into generic failures.

**Result**
The orchestrator can reason over failures reliably instead of getting random shapes per function.

---

### 4) Harden multi-task execution so batch work does not collapse
**Files**
- `supabase/functions/_shared/integrations/_dispatcher.ts`
- `supabase/functions/chat/index.ts`

**Changes**
- Upgrade `multi_action` execution with:
  - per-call isolation
  - bounded concurrency
  - stagger/delay for burst-sensitive providers
  - retry with backoff for transient failures
  - partial-success summaries
- Keep one failed provider call from aborting the entire multi-action turn.

**Result**
“Check Gmail, update CRM, and append to Sheets” becomes a real scalable pattern, not an all-or-nothing gamble.

---

### 5) Add registry health visibility so breakage is obvious before users feel it
**Files**
- `supabase/functions/chat/index.ts`
- `src/pages/Developer.tsx`
- optional small debug edge function or debug payload path

**Changes**
- Emit a cold-start registry report:
  - total tools
  - live tools
  - quarantined tools
  - counts by integration
- Show the same health summary in Developer Mode so broken registrations are visible immediately.

**Result**
You can see “Sheets quarantined, Gmail live” instead of discovering it through a failed chat turn.

---

### 6) Add a preflight validator so broken manifests never reach production again
**Files**
- new validator module reused by runtime and tests
- integration manifest docs / validation entrypoint

**Changes**
- Reuse the same recursive schema validator outside the tool loop as a preflight check for all manifest files.
- Validate:
  - array schemas have `items`
  - object schemas have sane `properties`
  - `required` keys exist
  - duplicate tool names are flagged
  - invalid enums / malformed branches are flagged

**Result**
Future integrations fail fast during validation instead of taking down live orchestration.

---

## Technical design notes
```text
Current:
legacy tools -> validated
manifest tools -> appended later, unvalidated
OpenAI sees one bad tool -> entire batch rejected

After:
assemble full callable registry
        ->
validate every tool recursively
        ->
live tools + quarantined tools
        ->
send only live tools to model
        ->
dispatcher normalizes all responses
        ->
multi_action isolates per-call failures
```

### Scope boundary
This plan covers **all AI-callable edge functions in orchestration**.
It does **not** expose webhook-only, auth bootstrap, or background scheduler functions as chat tools.

---

## Verification
1. Ask Gmail for a message while a different manifest is intentionally malformed:
   - Gmail still works
   - broken tool is quarantined
2. Run a multi-step turn across 3 integrations:
   - each call returns independently
   - one failure does not kill the other two
3. Confirm registry health shows:
   - live count
   - quarantined count
   - per-integration breakdown
4. Confirm structured diagnostics from failed provider calls reach the AI and UI instead of generic transport errors.
5. Add a new manifest with a schema bug:
   - preflight catches it
   - runtime quarantine still protects production if one slips through

---

## Order of execution
1. Hotfix the broken schema and final-list validation.
2. Move all callable edge functions under the orchestration registry.
3. Normalize response envelopes + dispatcher handling.
4. Harden `multi_action`.
5. Add health visibility.
6. Add preflight validation so this class of bug stays dead.
