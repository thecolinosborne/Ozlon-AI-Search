

## Make Slack Multi-Tenant (Per-User Workspace Install)

**The problem:** Right now `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` are global env vars. Whoever the token belongs to is the *only* workspace Ozlon can talk to. Every new user would need you to manually swap secrets — not scalable.

**The fix:** Convert your Slack app into a **distributable** OAuth app. Each Ozlon user clicks "Add to Slack", authorizes, and their workspace's bot token is stored *per-user* in `integration_connections` (same pattern you already use for ClickUp, GHL, Google, etc. — see `mem://architecture/per-user-integration-credentials`).

---

### What changes

```text
┌─────────────────────────────────────────────────────────┐
│ BEFORE: 1 token in env → 1 workspace → 1 user           │
│ AFTER:  N tokens in DB → N workspaces → N users         │
└─────────────────────────────────────────────────────────┘

User A clicks "Add to Slack" ──► OAuth ──► token stored under user_A
User B clicks "Add to Slack" ──► OAuth ──► token stored under user_B
                                              │
Slack event arrives ──► look up team_id ──► find user ──► use their token
```

---

### Steps

**1. Make the Slack app distributable** (one-time, you do this in Slack)
- https://api.slack.com/apps → Ozlon app → **Manage Distribution** → **Activate Public Distribution**
- Add Redirect URL: `https://iebmlegqknigeildujyp.supabase.co/functions/v1/slack-oauth/callback`
- Keep `SLACK_CLIENT_ID` + `SLACK_CLIENT_SECRET` as project secrets (these are app-level, shared across all installs — that's fine and correct)
- `SLACK_SIGNING_SECRET` stays global (it verifies the app, not the workspace)
- `SLACK_BOT_TOKEN` env var becomes a **fallback only** (or removed)

**2. New edge function: `slack-oauth`**
- `GET /slack-oauth/install?user_id=…` → redirects user to Slack's OAuth consent screen with state token
- `GET /slack-oauth/callback?code=…&state=…` → exchanges code for `access_token` + `team_id` + `bot_user_id`, calls `upsertIntegrationConnection('slack', { access_token, team_id, bot_user_id, team_name })`, redirects back to `/integrations/slack`

**3. New page: `src/pages/integrations/SlackDetail.tsx`**
- Mirrors existing `ClickUpDetail` / `GoHighLevelDetail` patterns
- "Add to Slack" button → `window.location = …/slack-oauth/install?user_id=…`
- Shows connected workspace name + disconnect button
- Register the card in `src/pages/Integrations.tsx`

**4. Refactor `slack-events/index.ts` to be multi-tenant**
- On incoming event, read `team_id` from the payload
- Look up `integration_connections` where `metadata->>team_id = X AND provider = 'slack'` → get the right user's bot token
- Cache `bot_user_id` per team (not globally) — fixes your earlier "Could not resolve bot user id" bug class permanently
- Use that token for `slackApi()` calls + AI reply attribution
- Signing secret check stays unchanged (it's app-level)

**5. Refactor `slack/index.ts` (chat tools)**
- Currently uses connector gateway with one `SLACK_API_KEY`. Switch to: read JWT → look up user's Slack `access_token` from `integration_connections` → call `slack.com/api/*` directly with that token
- Falls back to env var only if no per-user token (back-compat with your current setup)
- Same resolution pattern as `_shared/integrations/gmail.ts` etc.

**6. DB migration**
- No new tables needed — `integration_connections` already supports this
- Add an index on `(provider, (metadata->>'team_id'))` for fast webhook lookups

---

### Technical details

- **OAuth scopes to request** (in Slack app config + install URL): `app_mentions:read`, `channels:history`, `channels:read`, `chat:write`, `groups:history`, `im:history`, `im:read`, `im:write`, `mpim:history`, `reactions:write`, `users:read`, `users:read.email`, `search:read`
- **State param** in OAuth: signed JWT containing `user_id` + nonce, verified on callback to prevent CSRF
- **Slack event → user mapping:** Slack sends `team_id` at the top level of every event payload. One DB lookup per event (cached in-function for hot teams).
- **Backward compat:** Your current `xoxb-…` token gets migrated into an `integration_connections` row for your own user account so nothing breaks for you while the OAuth flow rolls out.
- **Manifest unchanged:** `_shared/integrations/slack.ts` (tool definitions) doesn't need to change — only the resolution layer in the edge functions.

---

### What you'll need from Slack (after approving plan)

1. `SLACK_CLIENT_ID` (from **Basic Information** → App Credentials)
2. `SLACK_CLIENT_SECRET` (same page)
3. Activate Public Distribution in the Slack app dashboard

I'll request these as secrets when implementation starts.

