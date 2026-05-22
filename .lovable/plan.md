## Goal

Stop email queries from looping or hitting "try a simpler request" by routing common email intents through deterministic recipes instead of the free tool loop.

## Approach

Add a lightweight intent classifier at the top of the chat edge function. When it matches a known email intent with high confidence, execute a fixed recipe (sequence of tool calls) instead of handing the request to the free-form tool loop. Anything not matched falls through to the existing loop unchanged.

This is additive — the current tool loop, anti-loop guard, and forced-synthesis fallback stay in place as safety nets.

## Scope (this plan)

Three recipes only. These cover the cases that have been failing:

1. **email_summarize** — "summarize the email from X" / "what did Y say"
   Recipe: `list_email_ids(q, max=5)` → `get_email(top_id, format=full)` → synthesize answer

2. **email_scan_notes** — "scan the Gemini/meeting notes in X's email" / "summarize the notes from Y"
   Recipe: `list_email_ids(q, max=3)` → `get_email(top_id, format=full)` → if Google Doc link found → `read_google_doc(doc_id)` → synthesize. If notes are inline, skip the doc step.

3. **email_attachment_analyze** — "summarize the PDF/attachment in X's email"
   Recipe: `list_email_ids(q, max=3)` → `get_email(top_id)` → `gmail_analyze_attachment(message_id, attachment_id)` → synthesize

## Where it goes

`supabase/functions/chat/index.ts` — single new module-level block:

```text
classifyEmailIntent(userMessage) → { intent, query, confidence } | null
runEmailRecipe(intent, query, ctx) → { messages, finalAnswer } | null
```

Called once, immediately after the user message is parsed and before the main tool loop starts. If it returns a result, we stream that result and skip the loop. If it returns null, the loop runs as today.

## Classifier

One cheap LLM call (`google/gemini-3.5-flash` via Lovable AI Gateway) with a tight system prompt:

- Input: user message + last assistant turn for context
- Output: strict JSON `{ intent: "email_summarize" | "email_scan_notes" | "email_attachment_analyze" | "none", gmail_query: string, confidence: 0..1 }`
- Only act when `confidence >= 0.8` AND intent ≠ "none". Otherwise fall through.

`gmail_query` is the Gmail search string the recipe will use (e.g. `from:ben tamburello`). The classifier is responsible for extracting the person/subject/keyword.

## Recipe executor

- Hard step cap per recipe (≤ 6 tool calls)
- Each step's result is appended to the running tool-message list so the final synthesis sees the same shape the loop would have produced
- If any step fails (no results, 4xx, scope error), return a precise partial-result message: what was searched, what was found, what's missing, what the user can do next — same format as the forced-synthesis fallback. Never fall back to "try a simpler request".
- Final synthesis is one tools-disabled LLM call against the gathered context, then streamed to the client identically to a normal answer.

## Guardrails preserved

- Existing anti-loop guard, gmail read counters, and 150s time budget remain untouched and protect the free-form loop path.
- `enableTools: true`, JWT passthrough, email reference ledger, no-DELETE policy all unchanged.
- Maton gateway calls keep `format=full`.

## Out of scope (deferred)

- Intent telemetry table (`chat_tool_traces`) — next plan
- Nightly eval suite — next plan
- Composite `find_and_read_email` tool — only if recipes prove insufficient
- Any UI changes — none

## Verification

1. Deploy `chat` edge function
2. Run four canned prompts via `curl_edge_functions` against the deployed function:
   - "Summarize the latest email from Ben Tamburello"
   - "Look for Ben Tamburello's email and scan the Gemini notes"
   - "Pull the notes from the Google Doc linked in Ben's last email"
   - "Summarize the PDF attached to the last invoice email"
3. For each: confirm the response terminates with a real answer (or a precise partial-result message) and step count ≤ 6
4. Check `edge_function_logs` for the classifier output and recipe path taken
5. Run one open-ended prompt ("what's on my plate today?") to confirm the free-form loop still runs unchanged

## Files touched

- `supabase/functions/chat/index.ts` — add classifier + recipe executor, wire into top of request handler

No other files. No migrations. No UI changes.
