
# Today → The Layer Above All The Apps

You've nailed the real question: **what's the actual job?** So far Ozlon = chat + comms. Useful, but it sits *next to* the other apps you already use. To matter, Today has to be **the layer above them** — the one place that ties everything together so you don't have to.

This plan is short on UI poetry, long on **what it actually does** that nothing else does.

---

## What's already out there (and where they all stop)

| Category | Examples | What they do well | Where they stop |
|---|---|---|---|
| **AI calendar planners** | Motion, Reclaim, Sunsama, Akiflow, Temporal | Auto-schedule tasks into time blocks, protect focus time | They only know about tasks + calendar. They don't know your inbox, your relationships, your money, your body. |
| **AI meeting notes** | Granola, Fireflies, Otter | Capture meeting context, draft follow-ups | Only during meetings. Forget you the minute you close the laptop. |
| **AI life trackers** | Lifestack, Bee, Exists, Rewind | Pull together health/calendar/data into a daily energy curve | They show you charts. They don't *do* anything for you. |
| **AI executive assistants** | Duckbill, alfred_, Martin | Will actually book a haircut, return a package, schedule a doctor | Mostly chat-only, US-only, narrow domains, no memory across asks. |
| **AI companions** | Pi, Replika | Warm, remember details, good at conversation | Pure conversation. Don't touch your real life — calendar, email, money. |
| **Morning briefing tools** | alfred_, BriefingAM | Audio/text summary of your day | One-shot per day. Static. Don't react when things change at 2pm. |
| **Productivity OSes** | Notion, Apple Reminders | Infinite flexibility | Empty by default. You build it. They don't bring intelligence. |

**The gap nobody fills:**
A single calm surface that **knows you**, **watches everything**, **prepares the next move**, and **does the thing** when you say go — across calendar, email, relationships, money, health, and recurring life admin. **One layer above all the apps.**

That's what Today becomes.

---

## The five real jobs Today does (everything else flows from these)

### Job 1 — The Morning Brief That Updates All Day

Other tools: morning email, then silent.
Today: a **living brief**. Three lines under the orb that change as the day changes.

> 7:42am — *"Slept 6h. Big meeting at 11. Carmen will probably reply today."*
> 11:15am — *"That ran long. I moved your 12pm call to 12:30."*
> 2:40pm — *"Carmen replied. Draft ready."*
> 6:00pm — *"Quiet evening. Tomorrow opens at 9."*

This is what alfred_ does once at 7am. Today does it **continuously**. That alone is differentiated.

### Job 2 — The Inbox Killer

Right now you have email + chat. Today **converts every inbound message that needs you into a card with a draft already attached**, in your tone, with the context auto-pulled from past threads.

You stop opening Gmail. You open Today, see *"Carmen wrote back. Here's a reply."*, tap **Send** or **Edit**. Done.

This is not Superhuman (faster inbox). This is **no inbox at all** — just the things that need you, surfaced one at a time, pre-handled.

### Job 3 — The Life Admin That Actually Gets Done

Birthdays, anniversaries, dentist, oil change, haircut, taxes, renewals, follow-ups. The stuff everyone forgets.

You tell Ozlon once. He remembers forever. He surfaces it at the right time with **the action already prepared**:

> *"Sarah's birthday in 6 days. Want me to plan something?"* → Tap → AI plans it.
> *"Dentist's been 5 months. Free Tuesday at 3?"* → Tap → calendar event created.
> *"Car insurance renews Friday. Old quote was $142, here's a $98 alternative."* → Tap → switch.

Duckbill does some of this manually with humans. We do it automatically with AI + your existing connectors.

### Job 4 — The Free-Time Matcher

The single most underused asset is your **free 15 minutes**. Motion blocks calendars but doesn't know what to do with the gaps.

Today watches your calendar all day. When a gap opens AND it matches something you've been meaning to do (haircut, call mom, read, walk), it offers it:

> *"15 min free at 2:15. Want to call mom back?"*
> *"45 min open at 3. You said you wanted to read more."*

This requires no new tech — just `signals-life` matching `life_events` against Google Calendar free/busy. **It's a feature nobody ships well.**

### Job 5 — The Body-Aware Adjuster

Lifestack shows your energy curve. Today **uses** it. Bad sleep night → softer day, fewer cards, no ambitious nudges. High-energy morning → push the hard creative work into the open block.

> *"Slept 4h. I'll keep today gentle. Moved your gym session to tomorrow."*

Apple Health → `life_pulse_daily` → feeds into the synthesis prompt → changes everything that surfaces. **The system literally treats you differently based on how you actually feel.**

---

## What Today does that NO competitor does (the moat)

| Capability | Motion | Granola | Pi | Lifestack | alfred_ | **Today** |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Knows your calendar | ✓ | ✓ | – | ✓ | ✓ | ✓ |
| Knows your inbox | – | – | – | – | ✓ | ✓ |
| Drafts replies in your tone | – | partial | – | – | ✓ | ✓ |
| Remembers people in your life | – | – | partial | – | – | **✓** |
| Remembers recurring life admin | – | – | – | – | – | **✓** |
| Matches free time to open intents | – | – | – | – | – | **✓** |
| Adapts to your physical state | – | – | – | partial | – | **✓** |
| Updates throughout the day | – | – | – | – | – | **✓** |
| Voice-first, conversational about *any* card | – | – | ✓ | – | – | **✓** |
| Plug-in skills (Booksy, etc.) extend any card's action | – | – | – | – | – | **✓** |
| Learns what to stop showing you | – | – | partial | – | – | **✓** |

The moat is **integration breadth × memory × proactivity**. Others have one or two. Today has all three.

---

## How we evolve it from here (the actual build path)

Three honest stages. Each one ships something usable on its own.

### Stage 1 — Make the chat + comms you already have **proactive** (1 build)
*Goal: prove the "morning brief that updates all day" feeling.*

- Ship the Today page (orb + one line + one card + pulse + also-today).
- Wire `signals-narrate` to update the one line every 30s + on email/calendar events.
- Connect inbox → for every Gmail reply from someone in your `life_people` (or replied-to in last 30d), draft a reply, put it on Today as a card.
- Add capture sheet for reminders/people/events.

After Stage 1, opening Today actually feels useful **today**. No new connectors needed beyond what you have.

### Stage 2 — Life admin + free-time matcher (1 build)
*Goal: prove the "I forgot, but Ozlon didn't" moment.*

- Ship `life_events` table + recurring event engine.
- Ship `signals-life` window pass: free Calendar slot + open `life_event` of intent type → Window card.
- Add 5–10 prebuilt **Life Admin Skills** users can install with one tap:
  - `birthday-planner` (researches gift ideas, drafts message)
  - `appointment-booker` (drafts the call/email to book it)
  - `subscription-watcher` (flags renewals + finds cheaper alternatives)
  - `follow-up-tracker` (notices when someone hasn't replied in N days)
  - `recurring-care-tracker` (dentist, haircut, oil change, etc.)

These are tiny — most are a prompt + 1–2 tool calls. They turn cards from suggestions into **actions**.

### Stage 3 — Body-aware + voice morning (1 build)
*Goal: prove "this thing knows me".*

- Apple Health via `@capacitor-community/health` → `life_pulse_daily`.
- Health data injected into all synthesis prompts → tone + count of cards adapts.
- New "Morning" mode: when you open Today before 9am, Ozlon speaks the brief out loud (existing ElevenLabs TTS). 30 seconds. Done. No app.

After Stage 3, Today is your morning ritual + your continuous safety net. **It becomes a habit, not a tool.**

---

## What we kill / deprioritize to make room

Be honest — some current things don't earn their space:

- **The Stack** page — fold its "actionable inbox" function INTO Today as the dot-stack under the main card. One less destination.
- **Skills** page — keep, but reframe as "**Helpers**" and put the most useful ones (Life Admin pack) front and center, not buried.
- **Personality / Wisdom Library** settings — move under one "**What Ozlon knows about me**" page. Stop scattering memory across 4 routes.

This consolidation makes the product comprehensible: **Today** (now), **Chat** (talk), **Connections** (what's hooked up), **What Ozlon knows about me** (memory). Four destinations. Done.

---

## The honest test of usefulness

After this ships, the test is simple:

> *"Did I open Today before I opened Gmail this morning?"*

If yes — we built the right thing. Every Stage above is tuned to make that answer "yes" for more days, faster.

A second test, after Stage 2:

> *"Did Today remind me of something I would have forgotten?"*

If yes once a week — habit forms. If yes 3x a week — replacement happens.

---

## Files (cumulative across stages)

**New**
- `src/pages/Today.tsx` (the new page; route stays `/signals` for now)
- `src/components/today/{Orb,NowLine,MainCard,DotStack,PulseStrip,AlsoToday,FloatingPlus,CaptureSheet,CardChat}.tsx`
- `supabase/functions/signals-narrate/index.ts` — the live one-line updater
- `supabase/functions/signals-life/index.ts` — anniversary + care + window passes
- `supabase/functions/signals-capture/index.ts` — unified router for the +
- `supabase/functions/relationship-watcher/index.ts` — inbound → drafted reply
- 5 new Skills under `public/sample-skills/life-admin/*.skill.json`

**Modified**
- `signals-synthesize` system prompt — adds plain-speak STYLE block + life context + pulse awareness
- `chat/index.ts` — adds 4 life tools
- `Index.tsx` — make Today the default landing for authenticated users (chat moves to `/chat`)
- Nav: rename "Signals" → "Today", consolidate Stack/Wisdom/Personality into "What Ozlon knows"

**Migrations (one)**
- `life_people`, `life_events`, `life_pulse_daily`, `now_line_state` — all RLS-protected.

---

## Bottom line

Today isn't a dashboard. It isn't a feed. It isn't a planner.

It's the **layer above all your apps** — the one that watches everything, prepares the next move, talks to you like a friend, and gets out of the way.

Nothing else on the market does all of this in one place. We have the pieces (chat, comms, wisdom engine, skills, voice, gauntlet routing). We just need to **point them at one job**: be the first thing the user opens every morning.

Approve and I'll build Stage 1.
