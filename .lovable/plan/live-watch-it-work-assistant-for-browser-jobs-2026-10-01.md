# Live "watch it work" assistant for browser jobs

## What you'll get
- **Live window in chat.** When you say "set up Google Tag Manager on ozlon.ai", a live browser window opens right inside the conversation. You watch it click and type as it happens.
- **It talks you through it.** Under the window, a running list of short, plain lines appears: "Opening Tag Manager", "Creating a container for ozlon.ai", "Copying the install code". If voice is on, it speaks each step out loud.
- **Clear status at a glance.** A small bar shows Thinking, Working, Waiting on you, or Done, plus how long it's been running and the step count. You never wonder whether it's doing anything.
- **It plans first.** Before starting, it shows a 3–6 step plan in plain words ("Sign in, create container, add GA4 tag, publish, install code on site"). Then it works through it and checks each step off.
- **You stay in control.** Pause, Stop, and Take over buttons. Take over lets you click in the window yourself (for sign-ins), then hand it back.
- **Nothing runs on your computer.** The browser runs in the cloud, so your computer stays fast. The window in chat is just a video-like view.

## Multi-step jobs like Google Tag Manager
- Built-in know-how for common setups: Tag Manager, Google Analytics, Search Console, Meta Pixel. It knows the right pages and the right order.
- When a job needs your site's code changed (pasting the tag into ozlon.ai), it does that part on its own and tells you.
- Sign-ins: it pauses, says "Please sign in to Google here", and continues after you do. Saved sign-ins are reused next time.
- Publishing or anything public still asks for one tap of approval first.

## Technical details
- `browser-agent`: add a `plan` stage (model produces steps before acting), emit a per-step `narration` line and `plan_index`, and write them to `browser_tasks.steps` after every action, not only at the end. Expose the Browserbase debugger live URL (`fullscreenUrl`, navbar hidden) in `status`.
- Pause/resume/takeover actions: takeover holds the session (keepAlive) and stops the agent loop; resume restarts it from the current page.
- New `BrowserLiveCard` in chat: an iframe of the live view, status pill, elapsed timer, checklist, and narration feed. It updates every 1.5s from `status`, or through realtime on `browser_tasks`. Add the card to the chat message renderer whenever a `browser_task` tool result arrives.
- Voice: new narration lines go through the existing text-to-speech path when voice is on, at most one line per 4s.
- Playbook hints for GTM/GA4/GSC/Meta Pixel in `browser-tools.ts`, so the planner starts from known-good steps.
- Verify end to end: run a real GTM container creation on a test account, and confirm the live window, narration, checklist, sign-in pause and approval gate all work, at desktop and phone sizes.
