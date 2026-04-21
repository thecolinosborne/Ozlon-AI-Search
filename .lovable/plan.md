

## Fix Routing Decisions Log + Show Live Work in Reply Bubble

### Issue 1: "Recent routing decisions (0)" never populates

**Root cause:** The Brain page reads from `gauntlet_routing_log`, which is only written when calls go through `gauntletCall`. But `gauntletCall` is only used when either:
- Project env var `USE_GAUNTLET=1` is set, **or**
- The user explicitly sets `prefs.use_gauntlet = true`

Neither condition is true today, so every chat call goes down the legacy `callWithFallback` path that writes to a different table (`model_routing_log`). The Brain page never sees those rows.

The Speed/Balanced/Quality toggle on the Brain page also only affects routing when gauntlet is active — so right now the toggle is cosmetic too.

**Fix:** Default `useGauntlet` to ON unless the user opts out.

In `supabase/functions/_shared/model-registry.ts` (line 382–385), change:

```
const envGauntlet = Deno.env.get("USE_GAUNTLET") === "1";
const userOptOut = (prefs as any).use_gauntlet === false;
const userOptIn  = (prefs as any).use_gauntlet === true;
const useGauntlet = !userOptOut && (envGauntlet || userOptIn);
```

to:

```
const userOptOut = (prefs as any).use_gauntlet === false;
const useGauntlet = !userOptOut;   // gauntlet by default
```

Result: every chat call goes through `gauntlet-router`, which writes to `gauntlet_routing_log`, which the Brain page already reads. The Speed/Balanced/Quality toggle becomes real on the same change. Existing fallback path is preserved (any gauntlet failure still falls back to the legacy gateway exactly as today).

### Issue 2: Reply bubble should show live work, not just placeholder

**Today:** While streaming, the empty assistant bubble shows three pulsing dots until tokens arrive. Tool calls/plan steps are surfaced separately in the floating `TaskActivityBubble` in the bottom-right corner — disconnected from the conversation. The chat already streams `task_update`, `tool_call`, `provider_used`, and `orchestration_trace` SSE events to the frontend, but the message bubble itself doesn't render them inline.

**Fix:** Render live work *inside* the assistant bubble while it's streaming.

1. **Surface task/tool events to the bubble.** Extend `ChatMessage` (in `useChatStream.ts`) with a transient `liveSteps: { label: string; status: 'in_progress' | 'done' | 'error' }[]` array. Populate it from the existing `onTaskUpdate` and `onToolCall` callbacks (we already receive these — currently they only feed the floating bubble). Push a new step on `in_progress`, mark matching label `done` on completion. Strip `liveSteps` before persisting (UI-only, ephemeral).

2. **Render a "Working" strip inside the empty/streaming bubble** (`ChatMessageList.tsx`). When the assistant bubble has no content yet but has `liveSteps`, replace the three-dots placeholder with a compact list:

   ```
   ⚙ Routing through Infinity Router…   ✓
   ⚙ Searching Gmail (last 7 days)…     ⏳
   ⚙ Drafting reply…                    ·
   ```

   Each row: small spinner/check/bullet icon + step label in muted text, animating in. Once tokens start arriving, the strip collapses into a thin "Done in X steps" line above the markdown content (click to expand). Same translucent card aesthetic as the bubble — no new visual surface.

3. **Keep the floating `TaskActivityBubble`** for long-running background tasks (so users can navigate away), but it's no longer the *only* place work shows up. The inline strip is the primary surface for "what is the AI doing right now" during the active reply.

### Files touched

- `supabase/functions/_shared/model-registry.ts` — default gauntlet ON (3-line change).
- `src/hooks/useChatStream.ts` — add `liveSteps` to inflight assistant message; populate from existing `onTaskUpdate` / `onToolCall`; clear after persistence.
- `src/components/chat/ChatMessageList.tsx` — render `liveSteps` strip inside the assistant bubble (replaces dots placeholder while streaming, collapses to one-liner once content arrives).

### Out of scope

- No schema changes (`gauntlet_routing_log` already exists and is read by the Brain page).
- No changes to the gauntlet-router edge function itself.
- No changes to TaskActivityBubble/Portal — they keep working as-is.
- No voice / onboarding / settings changes.

### Verification after implementation

1. Send any chat message → open Brain page → "Recent routing decisions" shows the new entry with chosen stone, model, latency.
2. Toggle Speed → ask the same question → next entry shows a faster/cheaper stone in the log.
3. Send a question that triggers a tool (e.g. *"summarize my last 3 emails"*) → assistant bubble shows live "Searching Gmail…" step *inside* the bubble before the answer streams in.

