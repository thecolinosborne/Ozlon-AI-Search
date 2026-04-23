

## Communications Hub v2 — fix Slack + go next-level

Two tracks. Track A fixes the Slack truncation you're seeing right now. Track B is the actual "next-level" upgrade: persistence, real unread state, thread awareness, AI triage, snippets→full bodies in the stream, and live updates.

---

### Track A — Slack actually pulls everything (root-cause fixes)

Current aggregator at `supabase/functions/communications-aggregate/index.ts` has 5 hard caps that quietly hide messages.

**Fix 1 — Per-type budgets, not a shared cap.**
Replace `channels.slice(0, 8)` with per-type budgets so DMs aren't starved by public channels:
- `im` (DMs): up to 25
- `mpim` (group DMs): up to 10
- `private_channel`: up to 15
- `public_channel`: up to 10 (but only ones the bot is already a member of, no auto-join spam)

**Fix 2 — Paginate `conversations.list`.**
Loop on `response_metadata.next_cursor` until budget is hit or cursor is empty. Today the very first page wins and the rest are invisible.

**Fix 3 — Real unread detection.**
For each channel call `conversations.info` once → read `last_read` ts. A message is unread iff `Number(msg.ts) > Number(last_read)`. Drop the hard-coded `isUnread: false`.

**Fix 4 — Real "needs reply" detection.**
Call `auth.test` once at the top, cache `bot_user_id` + the connected user's `user_id`. A message needs reply iff its text contains `<@${myUserId}>` OR it's in a DM (`channel.is_im`) and `msg.user !== myUserId`.

**Fix 5 — Pull more messages per channel + include thread replies.**
Bump `conversations.history` `limit` from 3 → 15. For any parent message with `reply_count > 0` and `latest_reply` newer than `last_read`, fetch `conversations.replies` and include the unread replies in the stream (so thread mentions stop disappearing).

**Fix 6 — Resolve all user IDs in batch.**
Today only IM owners get resolved. Collect every `msg.user` across all channels, dedupe, batch-resolve via `users.info` with a 200-entry in-function LRU. Display real names in `fromName` instead of "#channel" for channel messages.

**Fix 7 — Time budget + partial returns.**
Wrap the whole Slack pass in `Promise.race([work, timeout(8000)])`. If we time out, return what we have plus a `partial: true` flag the UI can show ("Slack still loading…").

---

### Track B — Next-level upgrades (the real product jump)

**B1. Persistent inbox cache (`communications_messages` table).**
New tables:
- `communications_messages` — `(id pk, user_id, source, channel, external_id, thread_external_id, from_name, from_handle, subject, preview, body_text, received_at, is_unread, needs_reply, raw jsonb, fetched_at)` with `unique(user_id, source, external_id)` and an index on `(user_id, received_at desc)`.
- `communications_read_state` — `(user_id, message_id pk, read_at, snoozed_until, archived_at, deleted_at)` so Done/Snooze/Hidden survive refresh and cross-device.
- RLS: owner-only on both, standard `auth.uid() = user_id`.

The aggregator becomes incremental: on each call, only fetch deltas (Gmail `historyId`, Slack per-channel `oldest=last_seen_ts`, GHL `dateUpdated > last_seen`). This eliminates the rebuild-from-scratch thrash and unblocks scale.

**B2. Bodies in the stream, not just snippets.**
The 240-char `preview` is why everything feels thin. Store `body_text` (Gmail full plain text, Slack message text resolved with `<@U…>` → @name, GHL message body) so the row itself can expand inline (tap → accordion) before opening the full ReplySheet. ReplySheet still uses `communications-thread` for full chains.

**B3. Realtime push via Supabase Realtime.**
Subscribe `Communications.tsx` to `postgres_changes` on `communications_messages` filtered by user_id. Aggregator writes to the table; the UI listens. New email arrives → row animates in without a refetch. Slack mention arrives → priority card updates live. (Slack events function already exists — wire it to upsert into the table on `message`/`app_mention` events.)

**B4. AI-classified priorities (replace the heuristic).**
Today `buildPriorities` is "newest unread/needsReply, top 3" — coarse. Replace with a single LLM pass at digest time:
- Input: top 25 unread messages (sender, subject, preview, channel).
- Output: `[{messageId, urgency: 0-1, reason: "…", actionHint: "reply | schedule | ignore"}]`.
- Top 3 by urgency become priorities; `actionHint` shows as a one-tap chip on the priority card ("Reply", "Add to calendar", "Mark read").
Use Lovable AI Gateway with `google/gemini-3-flash-preview` (cheap, fast, structured output via `response_format`).

**B5. Smart bundling.**
Group consecutive messages from the same sender within 30 min into a single row with a count badge ("Stripe · 4 messages · 2h ago"). Tap expands the bundle. Massively reduces Slack channel noise. The existing `groupCount` field is already on `CommMessage` — wire it.

**B6. Reply-anywhere composer.**
Long-press / right-click any row → quick-reply popover that drafts via `communications-draft` and sends without opening the full sheet. For Slack DMs and SMS this is huge; email keeps the sheet for subject/cc.

**B7. Snooze with real wakeup.**
`communications_read_state.snoozed_until` + a daily `scheduled-routines` pass that flips snoozed rows back to `is_unread=true` and pushes a Realtime update at the right moment. Replaces today's session-only `hidden` Set in `Communications.tsx`.

**B8. Channel health row.**
Top of the inbox: a thin row showing `Gmail ✓ 12 · Slack ⚠ partial · GHL ✓ 4 · last sync 14s ago`. Surfaces the partial-fetch state from Track A so the user knows when something's incomplete instead of guessing.

**B9. Voice-controlled triage.**
The mic button currently does nothing in `Communications.tsx`. Wire it to the existing realtime voice stack with a tiny intent map: "next", "reply with…", "snooze 1 hour", "delete", "what's urgent". Triage mode + voice = inbox-zero in 90 seconds.

**B10. Search.**
A single search input (cmd-K compatible) over `communications_messages` using full-text on `body_text + subject + from_name`. Postgres `tsvector` column + GIN index. No new infra.

---

### Out of scope (intentionally)

- Mobile push notifications (requires APNs/FCM setup, separate track).
- Outlook/iMessage/WhatsApp sources (manifest additions only, no architecture change needed once B1 lands).
- Calendar overlays in the inbox.

---

### Order of operations

1. **Track A (1–2 hours):** Slack truncation fixes. Immediate visible win — DMs and channels you're missing right now show up.
2. **B1 + B3 (persistence + realtime):** the foundation everything else compounds on. After this, refreshes are instant and incremental.
3. **B2 + B5 (full bodies + bundling):** the inbox stops feeling thin.
4. **B4 (AI priorities) + B8 (health row):** intelligence layer.
5. **B6 + B9 + B7 + B10:** the polish — quick reply, voice, snooze, search.

Each step is independently shippable and reversible.

### Verification per track

**Track A:**
- Connected Slack workspace with 30+ channels and several DMs → all DMs appear in the stream; channels paginate beyond the first 8.
- Mark a DM read in Slack → next refetch shows it as read in the hub.
- @-mention yourself in Slack → that exact message gets `needsReply: true`; mentions of others don't.

**Track B:**
- Disconnect from network, reload `/communications` → cached messages still render from `communications_messages`.
- Send yourself an email → new row animates in within 5s without manual refresh (Realtime).
- Tap a priority card with `actionHint: "Reply"` → ReplySheet opens with AI draft pre-filled.
- Bundle of 4 Stripe receipts → renders as one row with `(4)` badge; expands on tap.
- Snooze a message for 1 hour → disappears, reappears as unread an hour later (verified by inspecting `snoozed_until`).
- Voice "what's urgent" → reads top 3 priorities aloud.

