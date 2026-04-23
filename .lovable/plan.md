

## Communications Hub — Mobile Polish + AI-Native Composer

Three things to fix, in order. Each is independently shippable.

---

### 1. Kill the sticky summary on mobile

**Problem:** On mobile the `HeroDigest` (greeting + priorities + Brief Me button) is wrapped in an `<aside>` that becomes sticky on `lg:` breakpoints, but the *touch interaction* on mobile is triggering an iOS Safari quirk where the backdrop-blur card "sticks" to the finger because the parent scroll container has `overflow-y-auto` and the card has `backdrop-blur-xl`.

**Fix:** Replace the heavy hero card on mobile with a **compact AI Brief strip** — a single horizontal row with greeting + a small "Brief me" pill + a "Top 3" expandable accordion. Full hero stays on desktop only.

- Mobile (<lg): one-line strip, ~56px tall, no backdrop-blur on the touch surface, no sticky behavior at all. Tap "Top 3" to expand priorities inline.
- Desktop (≥lg): keep current `HeroDigest` as the left column.
- Remove `useScrollCollapse` on mobile entirely — the strip is already compact, no collapse needed.

**Files:** `src/components/communications/HeroDigest.tsx` (split into `HeroDigestDesktop` + new `CompactBriefStrip` for mobile), `src/pages/Communications.tsx` (conditional render via `useIsMobile`).

---

### 2. Make the AI the centerpiece — not the summary

Right now the digest is a passive 3-priority list. Replace the *philosophy* of the hero with an **AI Comms Console**:

**a. Smarter daily brief.** Replace `buildPriorities` heuristic with the AI triage pass we already scoped in Track B4 (Gemini Flash, structured output: `{messageId, urgency, reason, actionHint, suggestedReply?}`). The brief script becomes a real synthesized paragraph, not a template ("You have 4 things that need you today: Sarah is waiting on the contract, Stripe flagged a failed payment...").

**b. Inline AI actions on every priority card.** Each priority shows 2 action chips based on `actionHint`:
- `Reply` → opens quick-reply with AI draft pre-filled
- `Schedule` → opens calendar slot picker
- `Snooze 1h` / `Mark done` → instant
No more "tap card → open sheet → read → decide". The decision is surfaced upfront.

**c. Voice triage button (wire the dead mic).** The mic icon in the top bar currently does nothing. Wire it to the existing realtime voice stack with intents: `next`, `reply with…`, `snooze`, `delete`, `what's urgent`.

**Files:** new `supabase/functions/communications-triage/index.ts` (Gemini Flash, structured output), `useCommunicationsFeed.ts` (call triage, merge into priorities), `PriorityCard.tsx` (action chips), `Communications.tsx` (wire mic to `useRealtimeVoice`).

---

### 3. Reply & send directly from the hub — with proper email formatting

Today `ReplySheet` exists but composes plaintext only. Three upgrades:

**a. Rich email composer for Gmail replies.**
- Add a minimal rich-text editor (use `@tiptap/react` + `@tiptap/starter-kit`, ~30KB gzipped) with: bold, italic, lists, links, blockquote.
- Output sanitized HTML → send via existing `google-gmail` tool with `body_html` parameter (the manifest already supports `format: "html"`).
- Auto-include a quoted reply block of the original message (collapsed `<blockquote>` like Gmail does).
- Auto-append signature from `profiles.email_signature` (new column, optional, set in Settings).

**b. Channel-aware composer UI.**
- Email → full rich editor + subject + cc/bcc collapsed by default
- Slack/SMS/voicemail → single-line textarea, no formatting toolbar (matches channel norm)
- Composer header shows the channel pill so you always know what you're sending into

**c. New message / cold compose.**
- Add a floating "Compose" FAB (bottom-right on mobile, top-right on desktop) → opens the same composer with empty `to` field
- Channel selector at top: Email / Slack DM / SMS via GHL
- Recipient autocomplete pulls from recent senders in `communications_messages` + Gmail contacts

**d. Send confirmation + persistence.**
- On send: optimistic insert into `communications_messages` with `direction: 'out'` and `is_unread: false` so it appears immediately in the thread
- Toast with Undo (5s window) — calls Gmail `trash_message` or Slack `delete_message` if user undoes
- Failed sends queue to `communications_outbox` table for retry (new table, owner-only RLS)

**Files:**
- `src/components/communications/ReplySheet.tsx` — split into `ReplyComposerEmail.tsx` (rich) + `ReplyComposerChat.tsx` (plain)
- new `src/components/communications/RichEmailEditor.tsx` (Tiptap wrapper)
- new `src/components/communications/ComposeFab.tsx` + `NewMessageSheet.tsx`
- new `supabase/functions/communications-send/index.ts` — unified send endpoint that routes to the right provider tool, handles HTML formatting, signature injection, optimistic cache write
- new migration: `communications_outbox` table + `profiles.email_signature` column
- `src/pages/Settings.tsx` — add email signature editor

---

### Out of scope (intentionally)

- Attachments in compose (separate track — needs storage upload + MIME handling)
- Template library
- Send-later / scheduled send (Gmail supports it, but UI is its own thing)

---

### Order of execution

1. **Mobile fix (15 min):** kill sticky behavior, ship the compact strip. Immediate visible win on the device the user is on right now.
2. **Rich email composer (B3a) + send pipeline (B3d):** the core "respond from the hub" capability.
3. **AI triage (Section 2a + 2b):** priorities become useful, action chips replace dead taps.
4. **Compose FAB + new message (B3c):** outbound from zero.
5. **Voice triage (Section 2c):** the mic finally does something.
6. **Settings: email signature.**

---

### Verification

- iPhone preview at 320px wide → tap and drag on the hero area: nothing sticks to the finger, page scrolls normally.
- Mobile shows compact strip; rotating to landscape ≥1024px shows full desktop hero.
- Tap a priority card → action chip "Reply" opens composer with AI-drafted body already in the editor.
- Compose new email → bold a word, add a bullet list, send → recipient receives properly formatted HTML email with signature, not raw markdown.
- Send a Slack DM from the hub → appears in the stream within 2s as an outbound message; Undo within 5s removes it from Slack.
- Tap the mic, say "what's urgent" → AI reads the top 3 priorities aloud.
- Network offline → send queues to outbox; reconnect → auto-retries and surfaces a "Sent (1 queued)" toast.

