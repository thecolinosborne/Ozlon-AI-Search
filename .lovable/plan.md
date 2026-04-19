
## Scope: scrub all remaining Maton references

Maton is fully removed from active code paths — no edge function, no tools registered, no frontend usage. Only stale references remain. Cleanup is cosmetic + one orphaned config block.

## What to remove

**1. `supabase/functions/chat/index.ts`** — 7 stale comments referencing Maton:
- Line 225: comment header
- Line 990: ClickUp comment
- Lines 2739–2740: native Google router header (rewrite to remove "fall through to Maton")
- Line 2788: `// fall through to Maton` → `// caller handles failure`
- Line 2801: comment
- Line 6794: GHL comment
- Line 6816: dead-code comment about Maton tools (the conditional branch that injects GHL tools "if no Maton tools were added" — simplify to just always ensure GHL tools present)

**2. `supabase/config.toml`** — remove orphaned `[functions.maton]` block (lines 45–46). The function directory doesn't exist, so this block is dead config.

**3. DB CHECK constraint** — `integration_connections.provider` allows `'maton'`. Migration to drop `'maton'` from the allowed values. Safe: no rows use it (we'd verify with a SELECT first; if any exist, delete them since the integration is gone).

**4. Memory hygiene** — the following memory files reference Maton as if it's active. Update them to reflect "removed":
- `mem://integrations/maton-api-gateway` → mark as removed, replaced by native Google edge functions
- `mem://integrations/maton-chat-logic` → remove
- `mem://integrations/maton-gateway-constraints` → remove
- `mem://integrations/maton-binary-file-transfer` → remove
- `mem://integrations/identity-context-resolution-rules` → strip Maton mention
- `mem://features/email-management-system` → note it's now native Gmail edge function
- `mem://chat/action-execution-engine` → remove `MATON_ACTION_TOOLS` reference
- `mem://index.md` → update Core line about Maton query params (no longer relevant) and remove Maton entries

## What I'll verify before changing
- `SELECT count(*) FROM integration_connections WHERE provider = 'maton'` — if nonzero, delete those rows in the same migration.
- Re-grep for `MATON_` env vars or imports — none expected, but confirm.

## Risk
None. All edits remove dead code/config/notes. Chat behavior unchanged because the Maton fall-through path was never hit (no `maton` function deployed).

## Effort
~10 minutes. One edit pass on `chat/index.ts`, one on `config.toml`, one migration, ~6 memory file rewrites.

Approve and I'll execute in that order, ending with a redeploy of `chat`.
