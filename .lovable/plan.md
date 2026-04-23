

## Track A is consistent with the orchestration — one alignment fix recommended

Short answer: **yes**, the Slack aggregator changes fit the orchestration model and won't break anything. There's one small alignment issue worth tightening before moving on to Track B so this stays scalable.

### What fits cleanly

- `communications-aggregate` is a **read-only data function** consumed by the UI (`useCommunicationsFeed`), not a tool exposed to the AI. It lives outside the tool registry, so the per-tool quarantine guard in `chat/index.ts` doesn't apply and isn't needed.
- The Slack scope expansion (paginated `conversations.list`, real `last_read`, `auth.test`-resolved user IDs, threads, batch `users.info`) uses the same Slack API surface the registered `slack` tool already uses. No new auth path, no new schema, no new dispatcher seam.
- The new `partial: true` / `slackReason` fields are additive on the response — existing UI ignores unknown fields, so nothing downstream breaks.
- The 8-second `Promise.race` timeout matches the orchestrator's "fail soft, return what you have" pattern from the hardening plan.

### One alignment gap to fix

The orchestration plan (step 3) standardized a **single response envelope** for everything the AI touches via `_dispatcher.ts`. `communications-aggregate` currently returns a bespoke shape (`{ stream, priorities, partial, slackReason }`) instead of the normalized `{ ok, data, error?, diagnostics? }` contract.

That's fine **today** because only the React hook reads it. But the moment the orchestrator wants to call "summarize my comms" or "what did I miss on Slack" as a tool — which is exactly where Track B (AI triage, voice triage, priority chips) is heading — the dispatcher will see an envelope it doesn't recognize and either drop diagnostics or have to special-case this function.

### Recommended micro-fix before Track B

1. In `communications-aggregate/index.ts`, wrap the existing return in the normalized envelope:
   ```
   { ok: true, data: { stream, priorities }, diagnostics: { partial, slackReason, sources: {...} } }
   ```
2. In `useCommunicationsFeed.ts`, unwrap `data.data` and surface `data.diagnostics.partial` to the UI (this also unblocks the Track B "channel health row" with zero extra plumbing).
3. Register `communications-aggregate` and `communications-digest` as **manifest tools** (read-only, no destructive params) so the orchestrator can call them directly during multi-step turns like "brief me + reply to anything urgent."

### What stays out of scope

- No changes to the Slack tool manifest or quarantine guard — they're working as intended.
- No changes to `chat/index.ts` orchestration logic.
- Track B (`communications_messages` table, Realtime, AI priorities) proceeds unchanged after this micro-fix lands.

### Order

1. Envelope normalization + UI unwrap (~15 min, fully reversible).
2. Register the two comms functions in the manifest (additive).
3. Proceed with Track B (B1 + B3 first, as previously approved).

### Verification

- `/communications` still loads identically — same stream, same digest.
- Network tab shows the new envelope shape.
- A chat turn like *"what's in my inbox right now"* can call `communications_aggregate` as a tool and get a structured result instead of failing back to per-source tool fan-out.
- Quarantine guard logs show the two new tools as live, no schema warnings.

