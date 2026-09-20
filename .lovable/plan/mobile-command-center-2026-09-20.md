# Mobile command center

## Goal
Make the phone experience aligned, easy to navigate, and useful as a daily personal operating system.

## What will change
- Add a persistent mobile navigation bar with **Today, Chat, Life OS, Schedule, and More**.
- Keep the existing desktop experience unchanged.
- Turn the signed-in mobile home into a focused daily command center using the selected direction: greeting, voice-first action, and clear destinations.
- Route **Today** and **Schedule** to the existing Signals daily view, where calendar, to-dos, email watchouts, and command-center cards already live.
- Keep **Chat** as the execution surface and make switching between daily planning and action immediate.
- Align the top controls and prevent labels or buttons from clipping at narrow phone widths.
- Add safe-area spacing so the fixed navigation and chat composer never overlap content.
- Reuse the navigation on Life OS, Signals, Events, Memory, Communications, People, Stack, Settings, and related main screens.

## Productivity behavior
- Today opens the actionable daily briefing instead of a generic dashboard.
- Schedule opens the calendar section of that briefing.
- Life OS opens goals, rocks, scorecard, and issues.
- More exposes secondary destinations without hiding the primary workflow.

## Validation
- Check signed-in and signed-out states at 320×565 and 390×844.
- Verify every navigation destination, fixed bar, composer, and sheet remains reachable.
- Confirm the project builds cleanly and no current desktop route changes behavior.

## Technical details
- Create one shared mobile navigation component using existing semantic tokens and icons.
- Use route-aware active states and URL section targeting for Schedule.
- Add only scoped mobile layout adjustments; no backend or data-model changes.
