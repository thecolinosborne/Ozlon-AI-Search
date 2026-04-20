

## What's actually broken (from the logs)

1. **Trash deletion stalled at "task creation" instead of executing.** When you approved deleting 10 emails, the AI listed them ✓, asked permission ✓, then called `create_work_task` and `update_work_task` to mark itself "in_progress" — and **never called `batch_trash_emails`**. The executor hit task-management as a sidetrack and returned a status update instead of doing the action.
2. **Lovable gateway is 401-ing the planner pass** (`[Planner] gateway not ok: 401`). The Gauntlet shim was supposed to bypass this, but for the planner it's not engaging — the legacy path runs first and hits a dead `LOVABLE_API_KEY`.
3. **No proof the rest of Google works.** You haven't seen Calendar create / Drive list / Docs create / Sheets append / Slides create / GSC pull / Gmail send confirmed end-to-end since the Gauntlet rewire.

## The fix (three surgical changes + one test sweep)

### Fix 1 — Stop the "create_work_task" sidetrack on approved actions
In the executor system prompt (chat/index.ts), add a hard rule:
> "When the user has explicitly confirmed a destructive or external action (e.g. 'yes trash them', 'do it', 'go ahead'), execute the underlying tool immediately. Do NOT create or update a work_task as the action — work_tasks are tracking only and must be created in addition to, never instead of, the real tool call. Sequence: (a) call the real action tool first, (b) then optionally log a work_task with the result."

Plus a one-line guard in the tool loop: if the last assistant turn called only `create_work_task` / `update_work_task` and the user's prior message was an approval keyword (`yes`, `do it`, `go ahead`, `approved`, `confirm`), inject a synthetic system reminder on the next iteration: "You have not yet executed the action the user approved. Call the actual tool now."

### Fix 2 — Make Gauntlet the FIRST path for planner too
The shim in `model-registry.ts` is correct but the planner call path skips it because `prefs` isn't loaded for the planner pass. Fix: read `USE_GAUNTLET` env at the top of `callWithFallback` *before* checking prefs, so the env flag alone is enough. Also: if the Gauntlet returns ok for the planner, use it; if Gauntlet fails AND the legacy Lovable gateway returns 401, surface a clear "Lovable gateway key invalid — using direct providers" log instead of silently failing back to a dead gateway.

Concretely:
```ts
const envGauntlet = Deno.env.get("USE_GAUNTLET") === "1";
const userOptOut = (prefs as any).use_gauntlet === false;
const useGauntlet = !userOptOut && (envGauntlet || (prefs as any).use_gauntlet === true);
```

### Fix 3 — Verify the LOVABLE_API_KEY is actually valid (or remove it from rotation)
The 401s prove the Lovable key is dead or rate-limited. We'll add a one-time startup ping in `gauntlet-router /verify` for `lovable` (currently it's auto-passing without testing). If lovable returns 401, mark it `status: error` so the gauntlet stops picking it as a fallback. Your direct keys (OpenAI/Gemini/Anthropic) become the only chain.

### Test sweep — End-to-end smoke of every Google workspace tool
After the above ships, I'll run a scripted test (via `supabase--curl_edge_functions`) hitting each Google service through the chat function with a known-safe action:

| Service | Test action | Expected |
|---|---|---|
| Gmail | `list_emails` (10) → `trash_email` (1 specific id) → `untrash_email` | 200 + message id round-trip |
| Calendar | `list_calendar_events` (today) → `create_calendar_event` (test) → `delete_calendar_event` | event id created + deleted |
| Drive | `list_drive_files` → `drive_trash_file` (test) → `drive_untrash_file` | file moved + restored |
| Docs | `create_doc` → `read_doc` → `update_doc` | content round-trip |
| Sheets | `create_sheet` → `append_rows` → `read_sheet` | rows persisted |
| Slides | `create_presentation` → `add_slide` | slide id |
| GSC | `gsc_top_queries` (last 7d) | rows returned |
| GA4 | `ga4_report` (sessions, last 7d) | rows returned |

Each result gets logged to a smoke-test summary you can read in chat. Anything red gets a focused fix in the same session.

## Files touched (additive, surgical)

- `supabase/functions/chat/index.ts` — executor system prompt addendum + tool-loop guard for "approved-but-not-executed"
- `supabase/functions/_shared/model-registry.ts` — env-first Gauntlet flag check
- `supabase/functions/gauntlet-router/index.ts` — real lovable verify ping (currently auto-passes)

**Untouched:** every UI surface, every other tool definition, all 259 tools, all auth/onboarding/voice.

## Verification (what you'll see)

1. "Trash my last 10 emails" → list → "yes do it" → emails actually move to trash, work_task logs the *result*, no stalling.
2. Console shows `[Gauntlet shim] OK via gemini` instead of `[Gauntlet] planner via gemini-2.5-flash-lite -> 401`.
3. `/settings/brain` shows lovable stone as "error · key invalid" if it really is dead, so you know it's no longer the bottleneck.
4. The smoke-test sweep returns a clean grid: 8/8 green, or pinpoints exactly which Google service still needs reauth.

## Outcome

The orchestrator stops "thinking about doing" and starts doing. Your direct keys (OpenAI/Gemini/Anthropic/Higgsfield) become the verified primary path. Every Google workspace tool is proven working in one go, with results you can see.

