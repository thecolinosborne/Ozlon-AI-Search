---
name: Slack multi-tenant OAuth
description: Slack uses per-user OAuth install — each user installs the bot for their workspace, token stored in integration_connections (provider='slack', auth_type='oauth2'); slack-events resolves workspace by team_id, slack chat tool resolves by JWT
type: feature
---
**Architecture:** Slack is a distributable OAuth app. Each Ozlon user clicks "Add to Slack" on `/integrations/slack`, authorizes, and the workspace bot token is stored per-user in `integration_connections` (provider='slack', auth_type='oauth2', metadata={access_token, team_id, team_name, bot_user_id, scope}).

**OAuth flow:** `supabase/functions/slack-oauth/index.ts` (public, verify_jwt=false)
- `?action=install&user_id=...` → HMAC-signed state, redirect to Slack consent
- `?action=callback&code=...&state=...` → exchange via `oauth.v2.access`, upsert connection, redirect to `/integrations/slack`
- Redirect URI registered in Slack app: `https://iebmlegqknigeildujyp.supabase.co/functions/v1/slack-oauth?action=callback`

**Event handling:** `supabase/functions/slack-events/index.ts` reads `team_id` from payload → looks up `integration_connections` filtered by `metadata->>team_id` → uses that workspace's bot token. In-function `wsCache` (5min TTL) avoids per-event DB lookup. `bot_user_id` cached per workspace, not globally — fixes prior "Could not resolve bot user id" bugs across multi-workspace.

**Chat tools:** `supabase/functions/slack/index.ts` resolves user JWT → reads their stored `access_token` → calls `slack.com/api/*` directly. Falls back to Lovable connector gateway (`SLACK_API_KEY`) only when no per-user token (back-compat).

**Secrets:** `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` (app-level, shared), `SLACK_SIGNING_SECRET` (app-level), `SLACK_BOT_TOKEN` (legacy fallback only).

**DB index:** `idx_integration_connections_slack_team` on `(metadata->>'team_id') WHERE provider='slack'` for fast event lookups.

**Manifest unchanged:** `_shared/integrations/slack.ts` (tool definitions for the AI) didn't need to change.
