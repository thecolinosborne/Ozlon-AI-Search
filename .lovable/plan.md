## Goal

When you say something like "scan Ben's Gemini notes," the system should **deduce what you mean** (find the email, extract the doc link, summarize it), **confirm the plan in one line**, then execute deterministically. This applies to **every integration**, not just email.

## What changes

Replace today's narrow `classifyEmailIntent` (3 email intents only) with a **universal intent deduction layer** that runs at the top of every chat turn. The free-form tool loop stays as the fallback for genuinely open requests.

## Architecture

```text
user message
   │
   ▼
┌─────────────────────────────┐
│ 1. Intent Deducer (LLM)     │   one cheap call, ~300ms
│    → { intent, params,      │   gemini-3.5-flash
│        confidence, plan }   │
└─────────────────────────────┘
   │
   ├─ confidence < 0.7 ──► fall through to free-form tool loop
   │
   ▼
┌─────────────────────────────┐
│ 2. Confirmation Line        │   one short streamed message:
│    "I'll search Gmail for   │   "...— proceed?" with Yes/No chips
│     Ben Tamburello and      │   (auto-yes if confidence > 0.95
│     scan the linked Gemini  │    AND read-only)
│     doc. Proceed?"          │
└─────────────────────────────┘
   │
   ▼
┌─────────────────────────────┐
│ 3. Recipe Executor          │   fixed step sequence per intent
│    (≤ 6 steps, no LLM loop) │   structured error if any step fails
└─────────────────────────────┘
   │
   ▼
┌─────────────────────────────┐
│ 4. Synthesis (tools off)    │   final answer streamed normally
└─────────────────────────────┘
```

## Intent registry

A single file `supabase/functions/chat/_intents.ts` exports an array of intent definitions. Each definition has:

- `id` — e.g. `email.scan_notes`
- `description` — for the deducer's system prompt
- `params` schema — what the deducer must extract
- `recipe` — ordered list of tool calls with param interpolation
- `read_only` — boolean (controls auto-confirm)
- `confirmation_template` — one-line summary shown to user

### Coverage (initial set, covers ~90% of failing cases)

**Gmail / Outlook**
- `email.summarize` — summarize last email from X
- `email.scan_notes` — find email + extract & summarize linked doc/notes
- `email.attachment_analyze` — find email + analyze attachment
- `email.search` — list emails matching query
- `email.draft_reply` — draft a reply to a specific email

**Google Calendar**
- `calendar.today` — what's on my calendar today/tomorrow/this week
- `calendar.find_slot` — find available time with X
- `calendar.create_event` — schedule meeting with X

**Google Drive / Docs / Sheets**
- `drive.find_file` — find a file matching query
- `docs.summarize` — summarize a specific doc (by name or link)
- `sheets.read_range` — pull data from a sheet

**GoHighLevel**
- `ghl.find_contact` — look up contact by name/email/phone
- `ghl.recent_activity` — what's happened with X recently
- `ghl.create_task` — create task for contact
- `ghl.send_message` — SMS/email a contact

**Maton (cross-Google)**
- `maton.cross_search` — find anything matching query across all connected Google services

**Universal**
- `none` — falls through to free-form loop

## Confirmation behavior

You chose **"infer + confirm first"**, so every deduced intent emits a one-line confirmation before executing:

> "I'll search Gmail for Ben Tamburello, open the most recent email, and summarize the Gemini doc linked inside. Proceed?"

Streamed as a normal assistant message with two inline chips: **Proceed** and **Cancel**. Confirmation is **skipped only** when:
- intent is `read_only: true`, AND
- confidence ≥ 0.95, AND
- params are fully specified (no placeholders like "the latest")

Cancel either aborts or lets you edit the deduced query inline.

## Failure handling

If any recipe step fails or returns empty:
- Return a precise partial-result message: "Searched Gmail for `from:ben tamburello` — no results in last 30 days. Want me to broaden the query or try a different name?"
- Never fall back to "try a simpler request"
- Free-form loop is NOT invoked as a second attempt (would defeat the determinism)

## Guardrails preserved

- Existing anti-loop guard, gmail read counters, 150s budget — untouched
- Free-form tool loop — untouched, still runs when intent = `none` or confidence < 0.7
- Email reference ledger, no-DELETE policy, JWT passthrough — untouched
- Maton `format=full` — untouched

## Files touched

- **NEW** `supabase/functions/chat/_intents.ts` — intent registry (~400 lines, mostly data)
- **NEW** `supabase/functions/chat/_intent-deducer.ts` — single LLM classifier call + JSON parsing
- **NEW** `supabase/functions/chat/_recipe-executor.ts` — generic step runner with param interpolation
- **EDIT** `supabase/functions/chat/index.ts` — replace `classifyEmailIntent` + `tryEmailRecipe` with calls to the new modules
- **EDIT** `src/components/chat/` — minimal: render two inline chips (Proceed/Cancel) when assistant message has `meta.confirmation_pending = true`

No DB migrations. No new tables. No UI redesign.

## Verification

1. Deploy `chat` edge function
2. Run 8 canned prompts via `curl_edge_functions` covering email, calendar, docs, GHL:
   - "Scan Ben's Gemini notes"
   - "What's on my plate today?"
   - "Find Sarah's contact in GHL"
   - "Summarize the doc Jake sent me"
   - "Schedule 30 min with Mike next week"
   - "Pull last week's revenue from the sheet"
   - "What did Ben say in his last email"
   - "Find the invoice attachment from Acme"
3. Each should: deduce correctly, show confirmation line (or auto-execute if read-only + high confidence), terminate ≤ 6 steps, return a real answer
4. Check `edge_function_logs` for deducer output and recipe path on each
5. Run one ambiguous prompt ("help me with stuff") to confirm fallthrough to free-form loop still works

## Out of scope (next plan)

- Persisting deduced intents to `chat_tool_traces` for telemetry
- Nightly eval suite
- Learning from user "Cancel" feedback to improve deduction
- Composite tools (e.g. `find_and_read_email`) — only if recipes prove insufficient
