

## Status: not yet — Slack still missing `im:history`

### What's working
- **Email (Gmail):** sending and receiving works. Reply button auth is fixed.
- **UI:** Focus Stack, summary chip, outbox badge, cleaner thread rendering — all live.
- **Slack banner:** rendering correctly with the "Grant scope" button.

### What's still broken
**Slack DMs are still empty.** Edge logs from 2 minutes ago show 44+ identical `missing_scope: im:history` errors. The reconnect dialog opened (and you approved it), but the actual `im:history` checkbox wasn't toggled on before reauthorizing — the scopes provided to the bot are still:

```text
provided: channels:history, channels:read, groups:history,
          im:read, mpim:history, mpim:read, usergroups:read,
          users:read, chat:write, chat:write.customize, …
missing:  im:history   ← still not granted
```

DB also confirms zero Slack rows in `communications_messages`.

---

### Fix — re-trigger the reconnect, this time with explicit instructions

I'll fire the reconnect tool again. When the dialog opens:

1. **Find the scope row labeled `im:history`** (it should be highlighted/pre-selected).
2. **Make sure the toggle next to it is ON** — this is the step that was likely missed last time.
3. Click **Reauthorize** at the bottom — this redirects you to Slack to approve the new scope.
4. On the Slack consent screen, click **Allow**.

If the workspace requires admin approval for new scopes, you'll see a "Request to install" message instead of "Allow" — in that case the workspace admin needs to approve it.

After the scope lands, the next aggregator run (~30s) will pull DMs into `communications_messages`, the banner disappears, and Slack rows show in the stream.

### No code changes this round
This is purely a scope-grant retry. Code is already in place from the last pass.

### Verification
- After clicking Reauthorize → Allow, refresh `/communications`.
- The yellow Slack banner should disappear within ~30s.
- Slack DMs from the last 24h appear in the stream.
- The Slack chip in the channel filter shows a non-zero count.

