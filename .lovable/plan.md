

## Communications upgrade — surgical, additive

The replies feel generic because `draftFor()` in `ReplySheet.tsx` returns 4 hardcoded strings — one per channel — with zero awareness of what the message actually says or who sent it. Slack IS in the aggregator and IS in the unified stream, but its reply is the same canned "On it — taking a look now" line every time, which is why it feels missing. The hero summary is also static counts ("X messages across N channels") with no insight.

Three tight fixes, each independently revertable. No redesign of what you like.

---

### Fix 1 — Real per-message AI drafts (kills the "same reply every time" bug)

**New edge function:** `supabase/functions/communications-draft/index.ts`
- Input: `{ channel, fromName, subject?, preview, channelLabel }`
- Calls Lovable AI (`google/gemini-2.5-flash`) with a channel-aware system prompt:
  - **email** → 2–4 sentence reply, signature-friendly, matches subject tone
  - **slack** → 1–2 sentences, lowercase-friendly, no greeting/signoff (matches Slack norms)
  - **sms** → 1 sentence, casual, under 160 chars
  - **voicemail** → 1 sentence callback acknowledgment
- Falls back to current canned line if AI fails (zero regression risk).

**Frontend:** `src/components/communications/ReplySheet.tsx`
- Replace synchronous `draftFor()` with a `useEffect` that calls the new function when `message` changes.
- Show existing "AI draft ready" sparkle in a loading state ("Drafting…") then fade in the real draft.
- Add small "Regenerate" pill next to the sparkle row — calls the function again with a `tone` hint (`shorter` / `friendlier` / `firmer`). Optional, additive.

**Why this fixes Slack specifically:** Slack drafts will now reference the actual message content and channel name instead of the static "On it" line. Same for every other channel.

---

### Fix 2 — Smarter hero summary

**Backend:** `supabase/functions/communications-digest/index.ts` (already exists, already calls AI)
- Currently the heroLine + subLine are computed deterministically before the AI call and never use the AI output. Change: have AI return three short fields — `heroLine`, `subLine`, `briefScript` — in one structured JSON response (use `response_format: { type: "json_object" }`).
- Prompt the model to write the heroLine like a chief-of-staff: name the single most important thing ("Sarah's contract needs a yes/no today"), not a count.
- Subline becomes a one-liner of texture: "3 from clients, 1 from your team, nothing on fire." If the model fails or no priorities, fall back to current deterministic strings.

**Frontend:** zero changes — `useCommunicationsFeed` already consumes `heroLine`/`subLine`/`briefScript` from the digest response.

---

### Fix 3 — "Ultimate inbox" polish on the existing layout (no redesign)

Small additive UX improvements to what's already there:

**a. Channel filter chips above the stream** (`Communications.tsx`)
- Replace the single "All" dropdown with a horizontal pill row: `All · Email · Slack · SMS · Voicemail`, each with its tint dot + count badge. Dropdown stays for `Unread` / `Needs reply`. Faster scanning, one-tap filtering.

**b. Snooze + Mark done inline actions on `MessageRow`**
- On hover (desktop) / left-swipe (mobile, optional later) show two ghost buttons: `✓ Done` and `⏰ Later`. Local-only state for now (no backend write) — purely a focus tool that hides the row from the current view. Survives the session, clears on refresh. Establishes the pattern; persistence comes later.

**c. "Triage mode" toggle in the sub-header**
- A small `Triage` switch next to the filter. When on, the stream auto-collapses everything except `needsReply` messages, and tapping a row opens the ReplySheet AND advances to the next unread on send/close. Turns the page into a 90-second inbox-zero flow.

**d. Priority cards become tappable**
- `PriorityCard` already has an `onClick` prop — wire it up in `HeroDigest` to open the matching `CommMessage` in the ReplySheet. Currently tapping does nothing.

---

### Out of scope (explicitly not touching)

- The visual style you like — glass, blur, channel tints, hero card shape, BriefMe overlay — all stays.
- No changes to Gmail/Slack/GHL fetchers, RLS, schema, or auth.
- No new tables. Snooze/Done are session-only this round; persistence is a follow-up.
- No changes to the chat function, Descript, or the work_tasks fixes we just shipped.

### Order of operations

1. Fix 1 (real drafts) — biggest UX win, fully isolated to one new function + one component.
2. Fix 3d (priority cards tappable) — 5-line wire-up, instant value.
3. Fix 2 (smarter summary) — one edge function edit, zero frontend touch.
4. Fix 3a, 3b, 3c — UX polish, each independently revertable.

### Verification

- Tap any Slack message → draft references channel name + message content, not the canned line.
- Tap any email → draft addresses sender by first name and references subject.
- Refresh page → hero line names a specific item or person, not a count.
- Tap a priority card → opens that exact message's reply sheet.
- Toggle Triage → stream collapses to needs-reply only; sending advances to next.

