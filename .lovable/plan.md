

## Add Webhook Trigger Controls to ClickUp Integration

### What this does
Adds a "Webhook & Triggers" section to the ClickUp integration page so you can:
- Register the ClickUp webhook with one click (tells ClickUp to send comment events to your edge function)
- See webhook status (registered / not registered)
- Configure trigger words — defaults are `@ai`, `@pm`, `@wisdom`, and you can add your system name (e.g. `@ozlon`)
- Toggle auto-reply on/off
- Set reply mode (brief / standard / detailed)

Once the webhook is registered, typing `@ai` (or any configured trigger) in a ClickUp task comment will trigger the AI to respond in that same thread.

### Changes

**1. `src/pages/integrations/ClickUpDetail.tsx`** — Add webhook config UI section
- "Register Webhook" button that calls `register_webhook` with the edge function URL as the endpoint
- Webhook status indicator (green dot = registered)
- Trigger word chips showing active patterns, with option to add custom ones
- Toggle for auto-reply enabled/disabled
- Reply mode selector (brief / standard / detailed)
- All changes persist via `update_config` action to the database

**2. `supabase/functions/clickup/index.ts`** — Add custom trigger patterns support
- Currently `TRIGGER_PATTERNS` is hardcoded as `[@ai, @pm, @wisdom]`
- Update `handleWebhook` to load custom trigger patterns from the `clickup_integration_state` config (new `custom_triggers` column)
- Fall back to defaults if none configured

**3. Database migration** — Add `custom_triggers` column
- `ALTER TABLE clickup_integration_state ADD COLUMN custom_triggers text[] DEFAULT '{}'`
- Add `custom_triggers` to the `update_config` valid columns list

### No new pages or routes — this is a new section within the existing ClickUp detail page.

### Technical detail
The webhook endpoint URL will be: `${VITE_SUPABASE_URL}/functions/v1/clickup` — this is already handled by the edge function's `body.event` detection at line 495.

