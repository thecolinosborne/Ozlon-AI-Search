# GHL Sub-Account Memory — Three Layers

Make Ozlon remember which GoHighLevel sub-account you're working in across messages, sessions, and forever (as your default).

## What you'll be able to do

- *"Switch to Daddy Stroller"* → every message in this session now uses that account, automatically.
- *"Make Daddy Stroller my default GHL account"* → every NEW chat session starts with it, forever.
- Pick a default visually on the Go High Level integration page.
- Always see which account is active in the GHL settings page.

## How memory resolves on every message

```text
1. Did you name a sub-account in this message?     → use it + remember at session level
2. Does this session have an active account set?   → use it
3. Do you have a personal default account?         → use it
4. Fall back to the original metadata.location_id  → use it
```

## Build steps

### 1. Database (one schema migration)
- Add `default_ghl_location_id TEXT` to `profiles`
- Add `active_ghl_location_id TEXT` to `chat_sessions`

### 2. Backend (chat edge function)
- On every chat turn, resolve the active GHL location using the 4-step priority above
- When the AI calls `ghl_set_active_sub_account`, persist the choice to `chat_sessions.active_ghl_location_id` (session memory)
- Add new tool `ghl_set_default_sub_account` — writes to `profiles.default_ghl_location_id` (forever memory)
- Inject the active account name into the system prompt so the AI always knows which account it's operating on

### 3. UI (GHL detail page)
- Add a "Default sub-account" selector at the top — radio buttons or dropdown listing all configured sub-accounts
- Saves to `profiles.default_ghl_location_id` instantly
- Show a small badge on the active sub-account card: "Default"

### 4. Memory rule
- Save a project memory: "GHL sub-account resolution = explicit > session > user default > metadata fallback"

## Technical details

**Migration**
```sql
ALTER TABLE profiles ADD COLUMN default_ghl_location_id TEXT;
ALTER TABLE chat_sessions ADD COLUMN active_ghl_location_id TEXT;
```
Both nullable, no RLS changes (existing policies cover them).

**Chat function changes** (`supabase/functions/chat/index.ts`)
- After GHL credential resolution (~line 8193), look up `chat_sessions.active_ghl_location_id` for the current `sessionId`, then `profiles.default_ghl_location_id`. Apply the 4-step priority to set `GHL_LOCATION_ID_RESOLVED` and `GHL_API_KEY_RESOLVED` (matching the right sub-account's per-key API token).
- In `ghl_set_active_sub_account` handler (~line 4462): after mutating `ghlCreds`, write `active_ghl_location_id` to the current session row using the service-role client.
- New tool `ghl_set_default_sub_account` (description: "Set the user's permanent default GoHighLevel sub-account. Used across all future chat sessions."). Handler writes to `profiles.default_ghl_location_id`.
- System prompt: change the GHL block to print the resolved active account name AND note "(default)" or "(session override)" so the user can verify in the response.

**Frontend changes** (`src/pages/integrations/GoHighLevelDetail.tsx`)
- Read `profiles.default_ghl_location_id` on mount.
- Add a "Default for AI" section above the sub-accounts list with a select/radio control.
- On change, update `profiles.default_ghl_location_id` via Supabase client.
- Show a small "Default" pill on whichever sub-account row matches.

**Files touched**
- `supabase/migrations/<new>.sql` (new)
- `supabase/functions/chat/index.ts` (additive)
- `src/pages/integrations/GoHighLevelDetail.tsx` (additive)
- `mem://integrations/ghl-account-resolution` (new memory)

All changes are additive. No existing flows break — if the new columns are NULL, behavior is identical to today.

## Out of scope (intentionally)
- Cross-integration default (e.g. unified "active workspace" across GHL + ClickUp + Slack). Doable later as a generalization once GHL pattern proves out.
- Auto-detection of sub-account from message content (e.g. "create a contact for Daddy Stroller" without explicit "switch to"). The AI can already do this via the existing system-prompt instruction; will improve naturally as the pattern works.
