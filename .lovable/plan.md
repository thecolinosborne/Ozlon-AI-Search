

## Goal
Two things in one pass:

1. **Brain page**: let me update/replace the API key for **every** stone — including the system ones (OpenAI, Gemini, Higgsfield). Right now system stones are read-only (just show "connected" with a tail) and only Claude/Grok/DeepSeek/Mistral have an editable input. Fix that asymmetry, and make replacement keys auto-validate so a stone moves in/out of "Connected" based on whether its current key actually works.
2. **Full system scan**: walk every integration edge function + the orchestration layers (Gauntlet router, Infinity router, chat tool registry) and confirm the front-end calls match the back-end contracts. Surface anything broken; fix only what's actually broken (no cosmetic refactors).

---

## Part 1 — Brain page: every stone is editable

### Current behavior
- System stones (lovable/openai/gemini/higgsfield) → `StoneSlot` shows tail + verified time, no input. Key only changes if a project secret changes.
- BYOK stones (anthropic/xai/deepseek/mistral) → `ByokSlot` with input + connect/disconnect.

### New behavior
- **Every stone gets an editable input**, including OpenAI, Gemini, Higgsfield (Lovable stays read-only — it's the platform default).
- Each stone has three possible states:
  - **Connected (system key)** — the project secret works. Shows `••••<tail>` + "verified Xm ago" + an "Override with my key" link.
  - **Connected (your key)** — user pasted their own key, it validated. Shows `••••<tail>` + "your key" + "Replace" / "Remove (use system key)".
  - **Available** — neither system key nor user key is valid. Shows the input form to paste one.
- "Re-verify all" hits both system stones AND the user-keyed stones, so a dead key flips a stone back to "Available" automatically.

### How it'll work under the hood
- Reuse the existing `connect-brain` plumbing (which already stores per-user keys in `custom_models` with `metadata.platform_id`) for ALL stones, not just BYOK ones. OpenAI/Gemini already have presets there; we just expose the UI for them. Higgsfield gets added to `connect-brain` presets so personal Higgsfield keys work the same way.
- `gauntlet-router` `verifyProvider`: when checking a stone for a given user, prefer the user's personal key from `custom_models` (read via `inline:` secret pattern that's already there); fall back to the system env key. Verification result is what determines `status: active | error`. So if the user's key is bad, the row goes to "Available" even if a system key exists — because the user explicitly said "use mine."
- `gauntlet-router` `dispatch` (the actual call path): same precedence — user key first, system key fallback. This keeps live AI calls aligned with what the Brain page shows.
- New unified slot component `StoneSlot` (extended) replaces the current split between `StoneSlot` and `ByokSlot`. One component, three render states. `ByokSlot` deleted.

### Files touched (Part 1)
- `supabase/functions/connect-brain/index.ts` — add `higgsfield` preset; nothing else changes (openai/gemini already there).
- `supabase/functions/gauntlet-router/index.ts` — `verifyProvider` and `dispatch` accept a per-user key override looked up from `custom_models`. System key becomes fallback, not the only path.
- `src/components/gauntlet/StoneSlot.tsx` — extend to render "edit/override" UI; merge in the input + connect/disconnect from `ByokSlot`.
- `src/components/gauntlet/GauntletPanel.tsx` — drop the separate BYOK section; render every stone (lovable, openai, gemini, higgsfield, anthropic, xai, deepseek, mistral) through one unified `StoneSlot`. Lovable stays non-editable.
- `src/hooks/useGauntlet.ts` — extend `ALL_STONES` to include the BYOK ones; expose user-key status alongside system status so the slot knows which state to render.
- `src/components/gauntlet/ByokSlot.tsx` — deleted (logic absorbed into `StoneSlot`).

---

## Part 2 — Full system scan (read-only sweep, then fix what's broken)

I'll walk these in order and report findings inline. No edits unless something's actually broken.

### A. Edge function ↔ frontend contract check
For each integration, confirm the frontend caller invokes the right action with the right payload shape, and the function returns what the caller expects. Sweep covers:
- `clickup`, `gohighlevel`, `descript`, `higgsfield`, `plaid`, `youtube`
- All `google-*` (gmail, calendar, drive, docs, sheets, slides, search-console, analytics, tag-manager)
- `chat`, `realtime-session`, `transcribe`, `text-to-speech`, `voice-settings`, `voice-clone`
- `gauntlet-router`, `connect-brain`, `personality-evolve`, `scheduled-routines`
- `image-gen`, `video-gen`, `render-video`, `viral-creative`
- `knowledge-ingest`, `knowledge-search`, `summarize-session`, `vault-store`, `execute-task`

For each: verify (1) the function exists and deploys clean, (2) every frontend `supabase.functions.invoke(...)` call site uses an action the function actually handles, (3) per-user credential resolution follows the documented JWT-first pattern from `mem://architecture/per-user-integration-credentials`.

### B. Orchestration layer check
- **Gauntlet router** — confirm `pickStone` is actually being called by `chat/index.ts` (or whichever path) when `USE_GAUNTLET` env is set. Confirm fallback chain works (kill OpenAI key → next stone takes over). Confirm `gauntlet_routing_log` is being written.
- **Infinity router** — confirm the 6-path Gemini pre-processor still wraps chat turns (`INFINITY_ROUTER_ENABLED=true` is set). Confirm it doesn't double-route or strip tool calls.
- **Chat tool loop** — confirm `enableTools: true` is passed from the composer (per `mem://backend/agent-execution-constraint`) and that every tool in the registry has a working backend handler.

### C. Findings + fix policy
Anything actually broken (404 action, mismatched payload, dead env reference, contract drift) → I'll list it AND fix it in the same pass. Anything that's just stylistic or undocumented → I'll note it and leave it alone (per `mem://architecture/stabilization-policy` — no broad refactors).

---

## Verification (after edits)

**Brain page:**
1. Visit `/settings/brain` → every stone has an input or override action visible.
2. Replace the OpenAI key with garbage → row flips to "Available" with "key invalid" within ~2s of clicking save (verification runs immediately on connect).
3. Click "Remove" on the personal OpenAI key → row falls back to system key and flips back to "Connected".
4. "Re-verify all" → all stones (system + personal) re-check; tails and timestamps update.
5. Drop a personal Higgsfield key → next chat call that needs video routes to it (check `gauntlet_routing_log` shows `chosen_stone: higgsfield`).

**System sweep:**
6. Send a chat message that triggers a tool (e.g., "list my recent emails") → tool call resolves end-to-end, no swallowed errors, result rendered.
7. Send an image-gen request → routes via Gauntlet to gemini or higgsfield based on availability; output URL renders.
8. Kill the OpenAI key in personal storage → chat falls back to lovable/gemini per scoring; no user-visible failure.

## Outcome
Every stone is replaceable from the Brain page with live in/out validation, and the rest of the system is confirmed wired correctly end-to-end (or fixed if not).

