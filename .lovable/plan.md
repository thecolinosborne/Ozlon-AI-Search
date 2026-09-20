# Reliable Mobile Command Center

## Goal
Make mobile navigation dependable, remove the trapped “More” state, verify every destination, and make Ozlon’s information flow understandable and useful.

## Changes
1. **Fix the More menu**
   - Keep the menu above the bottom navigation instead of behind it.
   - Give it a phone-safe maximum height and its own scrolling.
   - Restore page interaction immediately when it closes or opens a destination.
   - Add the missing accessibility description.

2. **Make navigation consistent**
   - Ensure Today, Chat, Life OS, Schedule, Memory, Messages, People, and Settings all open correctly.
   - Make Schedule reliably jump to the schedule section, including repeated taps while already on Today.
   - Keep controls clear of phone safe areas and the fixed bottom bar.

3. **Test the mobile experience**
   - Test signed-in navigation at 320×565 and 390×844.
   - Test opening, scrolling, closing, and navigating from More.
   - Check destination actions, sheets, and chat controls for blocked taps or hidden content.
   - Confirm desktop behavior remains unchanged.

4. **Clarify information and evolution**
   - Add a concise in-app “How Ozlon learns” view from Memory showing what is stored, where it comes from, how it is used, and what Colin can review or remove.
   - Connect the explanation to the existing Memory and Life OS areas without changing the underlying privacy model.
   - Document disconnected or duplicated information paths and fix only high-confidence reliability gaps found during testing.

## Technical details
- Use the existing mobile navigation, sheet, Memory, Life OS, Signals, and chat patterns.
- Preserve additive development and existing visual language.
- Validate against preview telemetry and browser interaction, not compilation alone.
