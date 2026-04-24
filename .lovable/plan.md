# Capability Gap Recovery — Universal Policy

## Goal
Make Ozlon convert every non-transient tool failure into a buildable engineering spec, for ALL integrations (current + future). Prompt-only, zero infra changes.

## Why scalable for everyone
- Lives inside `buildSystemPrompt` in `supabase/functions/chat/index.ts` — applied to every user, every conversation, every tool call.
- Triggers on the dispatcher's universal error envelope (`Tool X failed: ...`) which already wraps every integration uniformly via `_dispatcher.ts`.
- No per-integration code: Gmail, Slack, ClickUp, GHL, Drive, Calendar, Sheets, Docs, GA, Plaid, Descript, and any future manifest dropped into `_shared/integrations/` automatically inherits the behavior.

## Single change
Insert a new `CAPABILITY GAP RECOVERY` section in `supabase/functions/chat/index.ts` between the `CORE ROLE` and `RESPONSE FORMATTING` sections (around line 5864).

The section instructs Ozlon to:
1. **Capture** the verbatim error.
2. **Classify** into one of: `transient_api_failure`, `auth_gap`, `service_not_connected`, `schema_gap`, `tooling_gap`, `policy_block`.
3. **Respond in two parts:**
   - User-facing plain explanation + smallest next step.
   - Markdown `### Capability Gap Report` with: `user_goal`, `attempted_tool`, `actual_error`, `gap_type`, `root_cause`, `minimum_fix`, `implementation_spec`, `fallback_options`, `retry_condition`.
4. **Always offer a fallback** so the user keeps momentum.
5. **Never** swallow errors, never repeat the same failed call unchanged, never emit the report for transient retries that succeeded.

## Verification
1. Deploy `chat` edge function.
2. Force a failure (e.g. call a tool with deliberately bad args via the chat UI) and confirm:
   - User-facing explanation appears.
   - `### Capability Gap Report` block is emitted with all fields.
   - A fallback is suggested.
3. Confirm a normal successful tool call does NOT emit the report.

## Files touched
- `supabase/functions/chat/index.ts` — single insertion (~50 lines) inside `buildSystemPrompt`.

No DB migrations, no new edge functions, no schema changes.
