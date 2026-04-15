

## Fix Webhook Registration & Enable Trigger Configuration

### Problem
The ClickUp API returns error `OAUTH_171: "Webhook configuration already exists"` when trying to register a webhook that's already set up. The edge function treats this as a failure, so the UI stays stuck on "Not Registered" even though the webhook is actually active.

### Changes

**1. `supabase/functions/clickup/index.ts`** — Handle "already exists" gracefully in `register_webhook`
- Wrap the `clickupCall` in a try/catch
- If the error contains `OAUTH_171` or "already exists", fetch the existing webhooks via `GET /team/{teamId}/webhook` to get the webhook ID
- Update `clickup_integration_state` with `webhook_status: 'registered'` either way
- Return success response in both cases

**2. `supabase/functions/clickup/index.ts`** — Also update `get_config` to check existing webhooks
- When loading config, if `webhook_status` is null/empty but a webhook exists on the ClickUp side, auto-correct the status

### No frontend changes needed
The UI already handles the "registered" state correctly — it shows the trigger word chips, auto-reply toggle, and reply mode selector. The problem is purely that the edge function throws instead of returning success.

### After deploying
- Re-click "Register Webhook" — it should succeed and reveal the trigger controls
- Add `@ozlon` as a custom trigger word
- Toggle auto-reply and reply mode
- Then you can test from ClickUp by commenting `@ozlon` on a task

