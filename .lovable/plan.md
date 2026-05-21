## Why failures keep happening (honest diagnosis)

The logs from your last attempt show **four independent bugs firing in the same turn** — each one alone would have broken the request. They survived because nothing in our system catches them before deploy:

1. **`gsc_query` envelope mismatch** — `chat/index.ts:3355` sends flat args; receiver requires `{ siteUrl, request: {...} }`. Result: `request object is required`.
2. **`ga4_list_properties` always 400s** — `google-analytics/index.ts:47` only sets the required `filter` query when accountId is provided. Without it, GA Admin API rejects.
3. **`ga4_run_report` accepts garbage property IDs** — AI passed `"Ozlon"` (a name) as `propertyId`. No regex guard, no resolver, weak tool description.
4. **`longFormBudget` ReferenceError** — `chat/index.ts:8399` reads a variable declared in a different function scope (`9912`). The tool loop crashes hard after any failure, killing recovery: `Tool loop error: ReferenceError: longFormBudget is not defined`. This is why even after GA/GSC fail, you got *nothing back* instead of a degraded answer.

Pattern: **integration handlers and the chat loop ship without integration tests.** Every new tool, every refactor, every envelope tweak is one typo away from blowing up your real session. That's what's frustrating you, and it's correct to want it fixed at the root.

---

## Part 1 — Immediate fixes (surgical, ship today)

| # | File | Change |
|---|---|---|
| 1 | `chat/index.ts` line 3355 | `gsc_query` mapArgs wraps fields in `request: {...}` |
| 2 | `google-analytics/index.ts` case `list_properties` | When `accountId` missing → call `accountSummaries.list` and return flattened `[{accountId, accountDisplayName, properties:[{id,displayName}]}]` (Google's official discovery flow) |
| 3a | `chat/index.ts` ~line 2545 (`ga4_run_report` tool def) | Description: "REQUIRES numeric `properties/<id>`. Call `ga4_list_properties` first if unknown." |
| 3b | `chat/index.ts` `ga4_run_report` handler | Pre-flight regex: if `property` ∉ `/^properties/\d+$/` → return structured error `{ category:"bad_arg", fix:"Call ga4_list_properties first" }` instead of forwarding |
| 4 | `chat/index.ts` lines 8399, 10371, 10404 | Replace cross-scope `longFormBudget` reads with a safely-scoped value (default to `modelConfig.maxTokens` when not in long-form path; or hoist the binding to the shared caller). Whichever is cleaner per local read — both end the ReferenceError. |

Deploy `chat` + `google-analytics` after edits.

## Part 2 — Stop the bleeding (system evolution, 1 sprint)

These are the smallest changes that would have caught all 4 bugs **before they hit you**:

### A. Tool contract smoke-tests (highest ROI)
Add `supabase/functions/_shared/integrations/__tests__/contract.ts` — for every registered tool, send a synthetic happy-path payload to the dispatcher with a recorder backend that asserts:
- Envelope shape (flat vs nested) matches the receiver's destructure.
- All `mapArgs` outputs include every field the receiver requires.
- Required-arg regexes (`properties/\d+`, ISO-8601 dates, etc.) fail loudly with a structured error.

Wire it into a GitHub Actions step (or a one-shot edge function `tools-contract-check`) that runs on push. Bugs #1 and #3 disappear permanently.

### B. Edge-function self-check endpoint
Each integration edge function gets `action: "selftest"` that:
- Validates env/secret presence.
- Runs the lowest-cost real API call (e.g. `accountSummaries.list` for GA).
- Returns `{ ok, latency_ms, error? }`.

A scheduled `pg_cron` job pings them every 6 h and writes results to a `integration_health` table. The chat system reads it before routing a tool call — if last status is `failed`, it skips the call and tells you why up-front instead of failing live. Catches bug #2-style regressions within hours.

### C. Strict-mode linting for the chat function
Enable TS strict mode + `noUnusedLocals` + a lint rule that flags references to identifiers declared in unrelated function scopes. Bug #4 (`longFormBudget` cross-scope read) is exactly what TS strict + eslint's `no-undef` would have rejected at deploy time. The `chat/index.ts` file is ~10.5k lines — without strict checks, scope leaks like this are inevitable.

### D. Structured error contract (already started — finish it)
Memory says: *"Return detailed structured errors to AI, don't swallow them."* The dispatcher already understands `{ category, ghl_status, ghl_message, minimum_fix }`. Make every integration edge function return that shape (GA and GSC currently return plain strings). The AI then knows *which next tool to call* instead of giving up — your last request would have self-recovered from bug #3 because the error would have said "call ga4_list_properties".

### E. Recovery in the tool loop
Wrap `runToolLoop` so any exception inside the loop returns a degraded answer ("I hit X, here's what I can still do") instead of throwing. Bug #4 propagated all the way out to the user as silence — that's the worst failure mode. One try/catch turns silent failure into a useful response.

### F. Per-integration health badge in the UI
Surface the `integration_health` table in `/integrations` as a small dot. When GA breaks at 3am, you see it instantly instead of finding out by typing a request. (Strictly additive; uses the existing IntegrationCard.)

---

## Suggested sequencing

- **This commit:** Part 1 (the four surgical fixes). Unblocks your 30-topic request.
- **Next commit:** D + E (structured errors + tool-loop recovery). Highest user-visible improvement.
- **Following:** A + C (contract tests + strict lint). Prevents regressions.
- **Later:** B + F (selftest + health badge). Long-term operational visibility.

## Scope guarantees

- Backend-only for Part 1 and most of Part 2 (only F touches UI, and additively).
- No DB migrations except a single `integration_health` table in step B.
- No changes to: voice, onboarding, GHL handlers, Higgsfield, Maton, Slack, ClickUp, or any working integration's behavior.
- No refactor of `chat/index.ts` architecture — only the four lines in Part 1 and an outer try/catch in Part 2E.

After Part 1 redeploys, retry the 30-topic request — expect a clean table with daily cadence and word counts, sourced from your real GA4 + GSC data.
