

## Test the Slack Multi-Tenant Install Flow

I'll verify the OAuth install endpoint is live and the frontend connect button works. Browser testing will:

1. **Hit `/integrations/slack`** in the preview to confirm the new SlackDetail page renders with an "Add to Slack" button.
2. **Click "Add to Slack"** — this should redirect to Slack's consent screen at `slack.com/oauth/v2/authorize` with the right `client_id`, scopes, and redirect URI.
3. **Stop at the Slack consent screen** and screenshot it. I won't click "Allow" because that requires your account credentials and would actually install the app — you should do that step manually so the workspace gets bound to your user.
4. **Verify the edge function** is reachable by curling `slack-oauth?action=install&user_id=<you>` and confirming it returns a 302 redirect to Slack.

If anything fails (missing redirect URL match, scope mismatch, function not deployed, etc.), I'll report exactly what Slack rejected and what to fix.

After you complete the install manually, I'll then verify the connection landed in `integration_connections` with the correct `team_id` + `access_token`, and that the events webhook can resolve your workspace.

