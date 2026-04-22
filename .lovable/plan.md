
## Communications Hub — Apple-Grade Unified Panel

The "Brief me" / Priority Stack is the **first 30%** of the screen. The other **70%** is a beautifully unified, Apple-Messages-style stream of every message from every channel — readable, scrollable, gorgeous. You get triage AND the full inbox in one view. No tabs to switch, no apps to open.

### The layout — one screen, two intentions

```text
┌──────────────────────────────────────┐
│ ← Communications              🎙    │  44px
├──────────────────────────────────────┤
│                                      │
│  Good morning, Sherwood.             │  ◄── HERO (collapses on scroll)
│  3 things need you today.            │
│                                      │
│  ◐ Sarah · contract reply   Gmail    │
│  ◐ Lead · pricing question  SMS      │
│  ◐ @mention in #launch      Slack    │
│                                      │
│  [▶ Brief me · 45s]                  │
│                                      │
├──────────────────────────────────────┤  ◄── soft gradient divider, no line
│                                      │
│  All Messages          [Filter ▾]    │  ◄── sticky sub-header
│                                      │
│  ─── Today ───                       │
│  ◉ Sarah Chen          2:14 PM   ●   │  ◄── unified stream begins
│  │ Re: Contract revisions...         │
│  │ "Looks great, just two changes…"  │
│                                      │
│  ◉ #launch · Slack     1:48 PM       │
│  │ @you can you review the deck?     │
│                                      │
│  ◉ +1 (415) 555-0142   12:30 PM  ●   │
│  │ SMS · "Hey is this still avail…"  │
│                                      │
│  ◉ Voicemail           11:02 AM  ●   │
│  │ ▶ 0:42 · "Hey it's Mike from…"    │
│                                      │
│  ─── Yesterday ───                   │
│  ◉ Stripe receipt      6:14 PM       │
│  ...                                 │
└──────────────────────────────────────┘
```

Hero collapses gracefully on scroll into a thin pill: `Good morning · 3 priorities ▶` so the unified stream takes the full screen, but you're never more than one tap from the brief.

### What makes it feel Apple

**1. One stream, every channel — no segmentation by app**
Email, Slack, SMS, voicemail all interleave by time. This is exactly how Apple Messages handles iMessage + SMS + RCS — the user shouldn't think about transport.

**2. Channel identity is whisper-quiet**
- 4px circular avatar dot in the channel's tint color (blue/purple/green/amber)
- Channel name as small caps metadata under the sender (`GMAIL · 2H`)
- No badges. No pills. No colored bars screaming for attention.

**3. Date dividers, not list separators**
Soft `─── Today ───` / `─── Yesterday ───` / `─── This Week ───` headers. Same pattern as Apple Mail and Messages. No row borders — only generous `py-4` spacing and a 1px `border-border/30` between groups.

**4. Conversation grouping**
Multiple messages from the same sender within 30 min collapse into one row with a count: *"Sarah Chen · 3 messages"*. Tap expands inline like Apple Mail's threading.

**5. Glass everywhere, lines nowhere**
- Hero: `bg-card/40 backdrop-blur-xl`
- Stream rows: transparent, hover gives `bg-card/30`
- Sub-header: `sticky top-14 backdrop-blur-2xl bg-background/70`
- Depth comes from blur, not borders

**6. Typography that breathes**
- Sender: 15px, `font-medium`, `text-foreground`
- Preview: 14px, `text-muted-foreground`, `line-clamp-1`
- Metadata: 11px, `uppercase tracking-wide`, `text-muted-foreground/60`
- Timestamps right-aligned, 12px, `tabular-nums`

**7. Voicemail rendered inline**
Tiny waveform + play button + duration. No new screen. Tap = play. Long-press = AI transcript expands inline.

**8. Smart filter, not a tab bar**
Single `[Filter ▾]` dropdown in sub-header — Apple uses dropdowns over tabs because tabs lock you in. Filter options: All · Email · Slack · SMS · Voicemail · Unread · Needs reply. State persists.

**9. Reply opens a sheet, not a new screen**
Tap row → bottom sheet (mobile) / right rail (desktop) slides up with thread + AI-drafted reply + voice mic button. Composer is channel-aware: "Send via Gmail" / "Send SMS via GHL". Dismiss = swipe down. This is the iOS Messages detail-view pattern.

**10. Pull-to-refresh + empty state celebrated**
Pull down → orb spins gently, re-aggregates, regenerates digest. Empty inbox = centered orb + *"You're caught up. Take the win."* No checkmark, no cartoon, just space.

### The unified row component (one component, every channel)

```tsx
<MessageRow
  channel="email" | "slack" | "sms" | "voicemail"
  avatar={...}            // sender avatar OR channel icon
  name="Sarah Chen"
  channelLabel="Gmail"
  preview="Re: Contract revisions..."
  timestamp={date}
  isUnread={true}
  needsReply={true}       // shows ◐ glyph
  audio={voicemailUrl?}   // renders inline waveform if present
  onTap={openSheet}
  onSwipeLeft={archive}
  onSwipeRight={snooze}
/>
```

One component renders every channel identically. Voicemail just adds an inline waveform; everything else is the same shape. This is what makes the panel feel unified — not "an email feed plus a Slack feed," but **one feed.**

### Mobile (320px — your current viewport)

Same layout, just tighter:
- Hero collapses to 1 line on scroll past 80px
- Priority cards stack full-width
- Stream rows: `px-4 py-3.5`, avatar 32px
- Date dividers center-aligned
- Reply = full-height bottom sheet

### Desktop (≥1024px)

Two-column split:
- **Left 38%**: Hero + Priority Stack + Brief Me (sticky)
- **Right 62%**: Unified stream with date dividers
- Click row → right column splits again into stream + thread detail (Apple Mail's three-pane vibe)

You see EVERYTHING from one screen, no scroll required.

### Architecture (additive, manifest-first — no changes to prior plan)

Backend stays exactly as proposed:
- `communications-aggregate` edge fn fans out via TOOL_REGISTRY (gmail, slack, ghl)
- `communications-digest` returns `{ heroLine, priorities[], briefScript }`
- `communications_digests` table (RLS, user-scoped)
- 1 GHL voicemail tool added to existing manifest

The unified stream is purely a frontend rendering choice — every source returns the same `CommMessage` shape, so they merge naturally by `receivedAt`.

### Files to add (frontend only — backend unchanged from prior plan)

- `src/pages/Communications.tsx` — page shell, sticky sub-header, scroll-collapsing hero
- `src/components/communications/HeroDigest.tsx` — collapses to pill on scroll
- `src/components/communications/PriorityCard.tsx` — glass, channel-tinted dot
- `src/components/communications/BriefMeButton.tsx` + `BriefMeOverlay.tsx`
- `src/components/communications/UnifiedStream.tsx` — virtualized list with date dividers
- `src/components/communications/MessageRow.tsx` — **one component for all channels**
- `src/components/communications/VoicemailInline.tsx` — waveform + play
- `src/components/communications/FilterDropdown.tsx` — single dropdown, no tab bar
- `src/components/communications/ReplySheet.tsx` — bottom sheet (mobile) / right rail (desktop)
- `src/components/communications/EmptyCaughtUp.tsx`
- `src/hooks/useCommunicationsFeed.ts` — returns `{ priorities, stream, digest }` from one query
- `src/hooks/useDailyBrief.ts`
- `src/hooks/useScrollCollapse.ts` — drives hero collapse animation
- Route `/communications` in `App.tsx` + nav entry

### Why this works

- **You see everything**: Unified stream below the fold = full inbox, always one scroll away
- **Triage is automatic**: Hero shows the 3 things that matter, AI-curated daily
- **It's beautiful**: Glass, generous spacing, no borders, channel color as a whisper
- **It scales**: Adding Outlook later = one new manifest tool, zero UI changes — the row component already handles it
- **It's voice-first**: Brief me reads it, mic replies to it, no keyboard required
