

## Remove Data Sources Toggles + Add Conversational Memory Updates

### Part 1: Delete the Data Sources section

The 8 toggles (Calendar, Email, Browsing, Location, Wearable, Voice, Documents, Transactions) are cosmetic and conceptually wrong — memory ingestion should follow integration connection state automatically, not a redundant on/off switch.

**Change:** Remove the entire "Data sources" section from `src/pages/IdentityMemory.tsx` (the section block, the `memoryOptions` array, the `settings` state, and the `toggleSetting` handler). Keep Identity, Standing Orders, and Active Goals untouched.

**Result:** Memory ingestion is governed by which integrations the user has connected on `/integrations` (single source of truth). No phantom switches.

### Part 2: Conversational memory updates ("now we do X, not Y")

This already partially works but needs a sharper write-path. Here's how it works today and what we add:

**Today (already wired):**
- The chat backend has a `save_memory` tool the AI calls when it detects a new durable preference. It writes to `wisdom_memories` (pgvector) and is loaded into the system prompt on future turns.
- Standing orders and goals are also writable from chat, but the AI is conservative about it.

**What's missing (the "update, don't duplicate" part):**
When you say *"actually, from now on do X instead of Y"*, the AI should:
1. **Find** the existing standing order / memory that conflicts (semantic match against `standing_orders.rule` and `wisdom_memories`).
2. **Supersede** it (mark old one inactive with a `superseded_by` link) and **insert** the new one — instead of stacking contradictory rules.
3. **Confirm** the change in chat: *"Updated: previously '…', now '…'."*

**Changes (backend only, no UI work):**

1. **`supabase/functions/chat/index.ts`** — extend the existing identity/memory tool surface:
   - Add `update_standing_order(old_rule_match: string, new_rule: string, scope?: string)` — does a fuzzy/semantic match against active orders, deactivates the old one, inserts the new one, returns both for the confirmation message.
   - Add `update_memory(old_summary_match: string, new_content: string)` — same pattern for `wisdom_memories`.
   - Strengthen the system prompt's House Rules block with: *"When the user phrases a change as 'now do X, not Y' / 'instead of … do …' / 'change the rule …', call update_standing_order or update_memory rather than save_memory or add_standing_order. Always confirm what was replaced."*

2. **Migration** — add `superseded_by uuid` and `superseded_at timestamptz` columns to `standing_orders` and `wisdom_memories` (nullable, additive only). Active-row queries already filter on `active = true` / equivalent, so this is non-breaking. Add an index on `(user_id, active)` if missing.

3. **No frontend work** — the existing Identity & Memory page already lists active standing orders/goals; superseded ones simply drop off the list automatically because they get marked inactive. Users can keep typing rules manually too.

### Behavior after this change

- *"Always reply in two sentences"* → AI calls `add_standing_order`. Appears in your list.
- *"Actually, three sentences from now on"* → AI calls `update_standing_order`, the two-sentence rule is deactivated, three-sentence rule replaces it. AI replies: *"Updated: previously 'two sentences', now 'three sentences'."*
- *"Forget the rule about sentence length"* → AI calls `update_standing_order` with empty new rule (deactivate path) or the existing trash icon still works manually.

### Files touched

- `src/pages/IdentityMemory.tsx` — remove Data Sources section + related state.
- `supabase/functions/chat/index.ts` — add 2 tools, strengthen House Rules prompt language.
- New migration — add `superseded_by` + `superseded_at` to `standing_orders` and `wisdom_memories`.

### Out of scope

- No changes to integrations, voice, onboarding, or any other settings page.
- No schema changes to `user_goals` (goals already have a `completed` status path that serves the same purpose).
- No changes to the existing manual add/delete UI for standing orders and goals — purely additive on the AI write-path side.

