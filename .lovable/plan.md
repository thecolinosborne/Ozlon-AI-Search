

## Two fixes — clickable links + Slack restored

### What's actually broken

**1. Long URLs aren't clickable.** Every place we render message bodies (thread bubbles in `ReplySheet`, message previews in `MessageRow`, fallback content) uses `whitespace-pre-wrap` on plain text. URLs render as inert characters. Same for email addresses and `@mentions`.

**2. Slack is silently empty.** The DB confirms zero Slack rows. Edge logs show **70+ `missing_scope` errors** — the Slack connector is missing `im:history` (and likely `mpim:history`/`groups:history` for some channel types). The aggregator's `slackReason` diagnostic flag exists but is **never rendered anywhere in the UI** — confirmed by grep. So Slack appears broken with no explanation.

---

### Fix 1 — Linkify everything that renders message text

Add a tiny `Linkify` component that takes a string and returns React nodes with:
- `https?://…` and bare `www.…` → `<a target="_blank" rel="noopener noreferrer">` with truncated display (max 48 chars, ellipsis in the middle: `https://example.com/…/path?q=1`)
- Email addresses → `mailto:` links
- Slack-style `<https://x|label>` → use the label as the visible text
- Preserves existing line breaks (replaces `whitespace-pre-wrap` rendering)

Apply in:
- `ReplySheet.tsx` — thread bubbles (line ~360) and fallback preview (line ~340)
- `MessageRow.tsx` — preview line (lines ~75 and ~80)
- `PriorityCard.tsx` — `what` field

Also strip Slack's `<https://url|label>` syntax in the aggregator's preview transform so the raw `<…|…>` doesn't show in the row.

**Email rendering bonus:** for Gmail thread bubbles where the original message was HTML, the current `stripHtml()` in `communications-thread` flattens it to plaintext. Keep that behavior (sanitization safety) but rely on Linkify to make the resulting URLs clickable. No raw HTML rendering — too risky without DOMPurify.

---

### Fix 2 — Bring Slack back + tell the user what's going on

**a. Surface the diagnostic.** Add a one-line `SlackStatusBanner` directly under the channel chips when `diagnostics.partial && diagnostics.sources.slack === 0`:

> "Slack messages can't load — missing `im:history` scope. **Fix scopes →**" (links to `/integrations/slack`)

Quiet, not alarming — same translucent card aesthetic. Dismissible per-session.

**b. Map error reasons to friendly text** in the aggregator: instead of just `"timeout"` or `"error"`, capture `missing_scope` from Slack responses and bubble up `{ reason: "missing_scope", scope: "im:history" }` so the banner can say exactly what to fix.

**c. Don't let one channel type kill the rest.** Currently when `conversations.history` fails for IMs, the IM channel returns no messages, but public/private channel history still works. Verify the per-channel `Promise.all` in `fetchSlackInner` actually catches per-call failures (it does via `slackGateway` returning `null`) — so public/group messages should still appear. The 70+ errors all being IMs explains the empty result: this user has only DMs in their workspace.

**d. Add a manual "request scope" hint on the Slack integration page.** The user can already manage scopes in Connectors, but the Communications page should deep-link them straight there. Add a copy of the exact scopes list needed: `im:history, mpim:history, groups:history` (channels:history is already granted).

---

### Files touched

- `src/lib/linkify.tsx` — new utility component
- `src/components/communications/MessageRow.tsx` — wrap preview in Linkify
- `src/components/communications/ReplySheet.tsx` — wrap thread bubbles + fallback in Linkify
- `src/components/communications/PriorityCard.tsx` — wrap `what` text
- `src/components/communications/SlackStatusBanner.tsx` — new diagnostic banner
- `src/pages/Communications.tsx` — render banner, pass diagnostics
- `supabase/functions/communications-aggregate/index.ts` — capture `missing_scope` reason + scope name into `diagnostics.slackReason`

No schema changes. No new dependencies.

---

### Verification

- Open any Gmail thread with a long marketing URL → the URL appears truncated with ellipsis and is clickable, opens in a new tab.
- Open a Slack thread containing `<https://docs.example.com/long-path|the docs>` → renders as the word "the docs" as a hyperlink.
- A message with `mailto:foo@bar.com` in the body → clickable email link.
- On the Communications page right now (Slack scope missing), a quiet banner appears under the channel chips: "Slack can't load — missing scope `im:history`. Fix scopes →" linking to the connector settings.
- After granting `im:history` in Connectors and tapping Scan → Slack DMs populate and the banner disappears.
- No double-render: links are not re-escaped or clipped by line-clamp at the wrong place.

