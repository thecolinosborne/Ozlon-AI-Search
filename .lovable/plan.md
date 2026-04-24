

## Why Slack messages are missing — and the fix

### Diagnosis (confirmed from connector + edge logs)

Your Slack connection (**Ozlon AI**, bot token via Lovable Connector) is configured with these scopes:

```text
configured: channels:history, channels:read, groups:history,
            mpim:history, im:read, chat:write, users:read, …
missing:    im:history   ← THIS is why DMs are blank
```

Edge function logs show **70+ identical errors** in the last run:

```text
[slack] conversations.history failed:
{"ok":false,"error":"missing_scope","needed":"im:history", … }
```

Translation: the bot can *see* your DM channels exist (`im:read` ✓) but can't *read messages inside them* (`im:history` ✗). Since most of your Slack traffic appears to be DMs, the hub looks empty. Public channels and group DMs would work — you just don't have many.

The in-app banner we built last pass **is rendering** ("Slack messages can't load — missing `im:history` scope. Fix scopes →") but the link sends you to `/integrations/slack`, which is our internal page. The actual scope toggle lives in **Connectors**, and the only way to grant a new scope on a Lovable Connector is the reconnect flow.

---

### The fix — three surgical changes

**1. One-tap reconnect with the scope pre-selected**

I'll trigger the `standard_connectors--reconnect` flow targeting your Slack connection (`std_01kps81f9qetrvgev483jgmt5y`) with `required_scopes: ["im:history"]`. This pops the connector settings with `im:history` highlighted — you toggle it on, click reauthorize, and you're done. No hunting through scope lists.

While we're there, I'll also request `groups:history` to be safe (private channels you may join later) and `reactions:read` (needed for the existing focus-stack "Done ✓" affordance to work via reactions, currently silently no-op).

**2. Banner upgrade — do it from the hub, no page-hop**

Right now the banner links to `/integrations/slack`. I'll swap that for an inline **"Grant scope →"** button that opens the connector reconnect dialog directly via the `lovable:open-connector` event the connector tool exposes. One tap, scope granted, banner disappears, Slack DMs appear in the next refetch.

Fallback link to `/integrations/slack` stays for users who'd rather see the explainer page.

**3. Make sure DM messages actually flow once the scope lands**

The aggregator's `fetchSlackInner` calls `conversations.history` for every DM channel returned by `conversations.list`. After the scope is granted, the next aggregator run will pull DMs and write them to `communications_messages` — realtime subscription already wired in `useCommunicationsFeed` will surface them within ~2s without a manual refresh.

I'll also add a tiny one-time "Slack just connected — scanning DMs…" toast on first successful Slack fetch after the diagnostic flips from `missing_scope` to clean, so you know it worked.

---

### Files touched

- `src/components/communications/SlackStatusBanner.tsx` — replace `<Link>` with reconnect button (calls the connector reconnect handler), keep page link as secondary
- `src/pages/Communications.tsx` — emit "scanning DMs" toast when `diagnostics.sources.slack` flips from 0 → >0 after a previous `missing_scope` state
- One reconnect tool call to grant `im:history`, `groups:history`, `reactions:read` on the Ozlon AI Slack connection

No edge function changes. No DB changes. No new dependencies.

---

### Verification

- Tap **Grant scope** on the banner → connector dialog opens with `im:history` already selected → click Reauthorize.
- Communications page auto-refetches → banner disappears → Slack DMs from the last 24h appear in the stream within ~3s.
- Filter chips show a non-zero number next to **Slack**.
- Tap any Slack DM row → `ReplySheet` opens with the thread loaded and a working **Reply** affordance.

