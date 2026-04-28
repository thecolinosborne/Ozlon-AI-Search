# Chat-driven GHL account switching + scope awareness

Make it so you can list, switch, and inspect your synced GoHighLevel accounts directly from chat — and have the AI tell you exactly which scopes are missing when an action would fail, instead of dying with a raw 403.

## What you'll be able to say

- *"Which GHL accounts do I have synced?"* → lists Ozlon + Daddy Stroller with scope counts and connected/disconnected state.
- *"Switch to Daddy Stroller for this conversation."* → flips active account; refuses if that account is toggled off.
- *"Make Ozlon my permanent default."* → persists across all future chats.
- *"Create a custom field 'Stroller Model' on Daddy Stroller."* → uses the active account's token; if `customFields.write` scope is missing, AI says exactly that and points you to the GHL token settings instead of failing.
- *"What can Daddy Stroller actually do?"* → lists capabilities derived from stored scopes.
- *"Why can't you do X for Ozlon?"* → AI compares required vs stored scopes and names the missing ones.

## Changes (all in `supabase/functions/chat/index.ts`)

**1. Widen the credential type (line 3131)**
Extend `ghlCreds.subAccounts[]` typing to include `scopes`, `location_name`, `disabled`, `last_verified_at`. These fields already exist in the DB and are loaded at line 8317 — just not typed all the way through.

**2. Enrich `ghl_list_sub_accounts` handler (lines 4464–4481)**
Return scope counts, capability groups (contacts / custom_fields / social_planner / products / calendars / etc.), `disabled` flag, `location_name`, and `last_verified_at` for every account — plus which one is currently active. This is what powers the "what can X actually do?" answer.

**3. Guard `ghl_set_active_sub_account` and `ghl_set_default_sub_account`**
If the matched account has `disabled: true`, refuse with a clear message: *"Daddy Stroller Social Club is currently disconnected. Re-enable it in Integrations → Go High Level first."* No silent switch to a dead account.

**4. New tool: `ghl_check_capability`**
Single-purpose helper the AI can call before a write. Inputs: `tool_name` (e.g. `ghl_create_custom_field`) and optional `location_id` (defaults to active). Returns: `{ allowed, missing_scopes, stored_scopes_count, recommendation }`. Uses the existing `ghl-scopes.ts` mapping to know which scopes each tool requires.

**5. Pre-flight scope check on GHL write tools**
Before any GHL write runs, compare its required scopes (from `ghl-scopes.ts`) against the active account's stored scopes. If something's missing, return a structured error to the AI immediately — no upstream round-trip, no opaque 403. The AI then tells you exactly which scope to add in your GHL token.

**6. One-line system prompt nudge**
Add to the GHL section: *"When the user asks 'which GHL accounts do I have', 'switch to X', or 'what can X do', call `ghl_list_sub_accounts` first. Before any GHL write, call `ghl_check_capability` if you're unsure the active account has the right scope."*

## Out of scope

- Adding GHL accounts from chat — paste tokens in the Integrations UI only (security).
- Toggling disconnect/reconnect from chat — handled in the Integrations UI.
- UI changes — the Integrations page already shows scope chips and the toggle.

## Files touched

- `supabase/functions/chat/index.ts` — type widening, two handler edits, one new tool + manifest entry, pre-flight wrapper, one system-prompt line.

No DB migration. No new edge function. No frontend changes.
