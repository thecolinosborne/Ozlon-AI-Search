
Goal: make account-specific Gmail commands reliably use the exact inbox you name, especially `colin@ozlon.net`, instead of “usually” working.

What I found
- Multi-account support was added, but it is still fragile.
- The current resolver only does exact `metadata.email === hint` matching. That breaks if the model passes variations like `colin@Ozlon.net gmail`, `my ozlon email`, extra spaces, or punctuation.
- Read-time context injection still defaults to the first connected Gmail account, which can bias the assistant toward the wrong inbox before any tool call happens.
- The prompt tells the model to pass `account`, but there is no hard normalization / aliasing layer to make that dependable.
- There is also no user-visible confirmation of which inbox was actually chosen for a tool call.

Plan

1. Harden account resolution in `supabase/functions/chat/index.ts`
- Replace the simple exact-match logic with a robust resolver that:
  - normalizes case, whitespace, punctuation, and trailing words like `gmail`
  - extracts email addresses from phrases like `colin@ozlon.net gmail`
  - supports partial/alias matching like `ozlon`, `colinosborne`, `my ozlon email`
  - checks multiple metadata fields, not just `metadata.email`
  - returns both the chosen connection ID and the resolved account label for logging/response text

2. Add explicit account extraction from the latest user message
- Build a helper that inspects the latest user message directly and derives an account hint even if the model forgets to include `args.account`.
- Priority order:
  1. explicit tool arg `account`
  2. extracted email/alias from latest user message
  3. default connection only if no signal exists
- This makes “colin@ozlon.net show me my inbox” work even when the model’s tool args are imperfect.

3. Remove first-account bias from injected Gmail context
- Update `injectMatonData` so Gmail and other multi-account services do not blindly use the first connection.
- If a specific account is mentioned, inject data from that account.
- If multiple Gmail accounts exist and no account was specified, inject a concise account list instead of silently reading one inbox and confusing the model.

4. Strengthen the system prompt/tool guidance
- Add stricter instructions that when multiple Gmail accounts are connected, the assistant must:
  - identify the requested account from the user’s wording
  - include the exact email in the tool call when possible
  - ask a clarification only if the request is ambiguous
- Add examples using your real pattern: `colin@ozlon.net gmail`.

5. Make tool results confirm the chosen inbox
- Update Gmail tool responses so they say which account was actually used.
- Example: “Using Gmail account: colin@ozlon.net. Found 10 emails…”
- This gives immediate proof that the resolver picked the right connection.

6. Apply the same reliability pattern to Google Calendar/Drive
- Reuse the same normalization + fallback account extraction for other Google services so account-specific commands behave consistently across the product.

7. Verify end-to-end after implementation
- Test commands like:
  - `colin@ozlon.net gmail show me my latest emails`
  - `delete the first 10 emails in my colin@ozlon.net inbox`
  - `from my ozlon email, pull unread messages`
  - `use colin@colinosborne.com gmail`
- Confirm the selected account is shown in the tool result and the correct inbox is affected.

Files to update
- `supabase/functions/chat/index.ts`

Expected result
- Saying `colin@ozlon.net`, `colin@Ozlon.net gmail`, or `my ozlon email` will reliably route Gmail actions to the ozlon inbox.
- If the request is ambiguous, the assistant will ask which inbox to use instead of guessing wrong.
- Every Gmail action will clearly report which account it operated on.

Technical notes
- No database changes needed.
- No frontend changes required for the core fix.
- Optional small enhancement later: surface the “active account used” in the task activity bubble, but that is not required to solve the routing bug.
