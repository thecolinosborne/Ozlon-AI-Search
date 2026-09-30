# One assistant, one Settings page

## Goal
Ozlon becomes one conversation with the orb, plus Settings. The complexity stays behind the scenes. You talk to it, and it connects services, pulls data and gets work done.

## What you will see
- **Main screen:** only the assistant. That's the orb, voice, and the conversation.
- **Answers as cards:** your schedule, to-dos, watch-outs, Life OS, events, people and business plans show up as cards inside the chat when you ask or when they matter. For example, "what's my day" shows the Today card. Tapping a card opens a full view as a sheet, and you stay in the chat.
- **Settings:** holds your connections (Gmail, Calendar, ClickUp, GoHighLevel, Slack and the rest), profile, voice, brain, memory, skills, and a "Manage" section for Life OS, People, Events and the others when you want to edit something by hand.
- **Menu:** the bottom bar and top menu shrink to two items, Assistant and Settings.
- **Nothing gets deleted.** Old page links still work and open inside Settings.

## Connecting in conversation
- Say "connect my Gmail" or "hook up ClickUp" and a connect card appears in the chat. Tap it, sign in, and you're done.
- Say "what's connected?" and it lists what's live, what's broken, and what needs reconnecting, with a fix button on each one.
- When a request needs a service you haven't connected, it offers the card instead of failing.

## Browser agent (phase 2)
- The assistant gets a cloud browser. It can open sites, search, click, fill forms, log in where you allow it, and bring back results or screenshots.
- It works from your phone, and a live step list shows what it's doing.
- It asks you first before submitting, paying or sending anything.

## Your own computer (phase 3, later)
- A small helper app for Mac/PC so it can run scripts and control apps on your machine. This is a separate build and is only planned for now.

## Build order
1. Two-item navigation, assistant-only home, Settings with a Connections area and a Manage section, old links redirecting.
2. Chat cards for Today, Life OS, Events, People and Business plans, each opening its full view in a sheet.
3. Connect / status / reconnect cards triggered from conversation.
4. Cloud browser agent with a live step view and an approval step before risky actions.
5. Test each step at phone and desktop sizes before moving on.

## Technical details
- Replaces the earlier "no UI redesign" rule, because you asked for this directly. Record that in memory.
- Existing pages are reused as sheet contents and `/settings/manage/*` routes; `/life`, `/signals`, `/events`, `/people`, `/memory`, `/stack` redirect there.
- The chat backend returns structured card payloads (`card: today|life|events|people|outcome|connect|browser`) that the message list renders. The tool-call logic stays the same.
- Connect cards reuse the existing integration OAuth flows from the Integrations page.
- Browser agent: a cloud headless-browser service called from an edge function, with steps streamed to the chat. The provider gets picked at phase 2 and needs its API key.
- Many tools are behind the assistant, so tool search / invoke deferral keeps each turn fast.
