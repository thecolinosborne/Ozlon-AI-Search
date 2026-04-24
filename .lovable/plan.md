

## Communications Hub — Next-Gen Pass

Three surgical upgrades. No redesign of the rest of the app. Everything additive, all behind the existing `/communications` route.

---

### 1. Kill the summary, give the page a real spine

**Remove on mobile:** `CompactBriefStrip` is gone. The hero section is the message stream itself.

**Demote on desktop:** `HeroDigest` becomes a thin **"Today" rail** docked into the left column — just the greeting + a single inline `Brief me (45s)` button. No priorities list, no big card. The Brief overlay still exists if the user taps it. Priorities live inside the stream now (see #2).

**New top of stream:** a one-line **smart summary chip** above the message list:
> "12 unread · 3 need reply · Slack quiet today" — generated from already-loaded data, no extra fetch. Tap → filters to "needs reply".

This reclaims ~40% of the viewport for the actual inbox, which is what the user comes here for.

---

### 2. The "wow" interaction: AI-ranked **Focus Stack**

Replace the current flat stream's top section with a **Focus Stack** — the top 3 messages the AI thinks matter most, rendered as full-width tactile cards with three actions baked in:

```text
┌──────────────────────────────────────────────┐
│  ●  Sarah Chen — Acme Q3 contract             │
│     "Need your sign-off before Friday EOD"    │
│     · email · 2h ago · high                   │
│                                                │
│   [ ✨ Reply with AI ]  [ Snooze 1h ]  [ ✓ ]  │
└──────────────────────────────────────────────┘
```

- **One-tap "Reply with AI"** opens `ReplySheet` *with the suggested draft already in the editor*. Already wired in `useCommunicationsFeed` — we just promote it from a dim PriorityCard into a hero row.
- **Snooze / Done** chips work without opening the sheet. Already wired.
- Cards use the channel tint as a left edge accent (1.5px), urgency dot top-left.

Below the Focus Stack, a clean divider ("Everything else") and the existing `UnifiedStream`. Same component, no rewrite.

---

### 3. Make replies actually work + readable threads

**Fix A — the Reply button doesn't fire.** Edge logs show **zero invocations** of `communications-send`. The button calls `supabase.functions.invoke("communications-send", { body })` but the function requires an `Authorization` header and **the supabase-js client doesn't auto-attach the session JWT for `functions.invoke` in some browser cases** when there's no `apikey`. We'll explicitly grab the session and forward the access token in the invoke headers, plus add a visible toast on the catch path so failures stop being silent. Also add a one-line console.error tag so future debugging is instant.

**Fix B — HTML soup in email threads.** Today `stripHtml()` in `communications-thread` flattens HTML into plain text but leaves orphaned CSS classes, tracking-pixel alt text, and table layout artifacts. We'll do three things:

1. **Server side (`communications-thread`):** before stripping, drop `<head>`, `<style>`, `<svg>`, `<img>` (keep alt only if meaningful), and collapse repeated whitespace/zero-width chars. Strip Outlook/Gmail quote blocks (`<blockquote class="gmail_quote">`, `On ___ wrote:`) into a single collapsible `--- earlier ---` marker.
2. **Client side (`ReplySheet` thread bubbles):** if the cleaned body is >800 chars, show first 400 with a **"Show full message"** chevron. Marketing emails stop dominating the sheet.
3. **Quoted history collapse:** any text matching `On ___ wrote:` or `> ` line patterns gets folded into a "Show quoted history" toggle. Standard mail-client UX.

**Fix C — composer UX.** Two small things:
- The "AI draft ready" sparkle pulses while drafting; after first draft, pulse **once** then go solid. Currently it pulses forever when `isDrafting` flickers.
- Send button gets a loading spinner inline + disabled state. Today it's a flat send icon with no feedback.

---

### 4. Scalability hooks (no UI cost)

While we're in here, three small architectural moves so this scales as channels grow:

- **Channel registry** in `src/components/communications/channels.ts` — `{ source, channel, label, tint, icon, send: (body) => Promise }`. Today the send pipeline switches on `source` in three places (ReplySheet, communications-send, MessageRow). One registry; new channels (Discord, Teams, WhatsApp later) drop in with one entry.
- **Triage cache key tied to stream hash** — currently `["communications", "triage"]` refetches every 2 min regardless. Key on the top-20 message IDs so it only re-runs when there's actually new mail. Cuts AI cost ~80%.
- **Outbox surfaced inline** — when `communications-send` fails it already writes to `communications_outbox` (table exists). Add a tiny "1 message queued · retry" pill at the bottom of the stream when the outbox is non-empty. Auto-retry on next `Scan`.

---

### Files touched

- `src/pages/Communications.tsx` — drop `CompactBriefStrip`, render Focus Stack + summary chip
- `src/components/communications/CompactBriefStrip.tsx` — delete
- `src/components/communications/HeroDigest.tsx` — slim to "Today rail" (greeting + Brief button only)
- `src/components/communications/FocusStack.tsx` — new (3 hero cards, urgency-ranked)
- `src/components/communications/SummaryChip.tsx` — new (one-line counts above stream)
- `src/components/communications/OutboxBadge.tsx` — new (queued retry pill)
- `src/components/communications/ReplySheet.tsx` — fix invoke auth, send-button spinner, quoted-history collapse
- `src/components/communications/channels.ts` — new (channel registry)
- `src/hooks/useCommunicationsFeed.ts` — triage cache key tied to stream hash
- `supabase/functions/communications-thread/index.ts` — better HTML cleaner, drop `<head>/<style>/<svg>/<img>`, fold quoted history
- `supabase/functions/communications-send/index.ts` — log invocation entrypoint for debugging

No DB migrations. No new dependencies. All existing routes/keyboard shortcuts/voice mic preserved.

---

### Verification

- Open `/communications` on mobile — no summary card visible. Stream starts ~14px below the header. Top 3 priority cards have inline `Reply / Snooze / Done`.
- Tap "Reply with AI" on a priority card → `ReplySheet` opens with the AI draft already in the editor (not blank).
- Type a reply, hit send → spinner shows, message lands in `communications_messages` (visible in DB) within ~2s and a toast confirms `Sent via Gmail`. If it fails, an error toast shows the actual reason (no more silent failure).
- Open a marketing email thread → no raw CSS class names, no inline `<style>` text, no `[image:0]` markers. Long emails truncate to first 400 chars with "Show full message".
- Replies to threaded Gmail conversations fold the prior history into a "Show quoted history" toggle.
- Tap the summary chip "3 need reply" → stream filters; tap again → unfilters.
- Disconnect network, send a message → "1 message queued" pill appears; reconnect + Scan → it sends and pill disappears.

