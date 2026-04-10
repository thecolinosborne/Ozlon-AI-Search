

# Multi-Account Gmail Support

## Problem
The `connMap` only stores one connection per app (first-wins). Both your Gmail accounts exist in Maton, but `colin@colinosborne.com` always gets used because it was created first. When you say "colin@ozlon.net", the system ignores that and hits the wrong account.

## Solution
Store ALL connections per app, expose account metadata to the AI, and let it pick the right connection based on your message (e.g. "colin@ozlon.net gmail").

## Changes — `supabase/functions/chat/index.ts`

### 1. Multi-connection map
Replace `connMap: Map<string, string>` with `connMap: Map<string, Array<{id: string, email?: string, meta?: Record<string, unknown>}>>`. Store all connections per app, preserving metadata (especially `email`).

### 2. Account-aware connection resolver
Add a helper function `resolveConnection(connMap, app, hint?)` that:
- If only one connection exists for the app, returns it
- If multiple exist and a `hint` (email address) is provided, matches against `metadata.email`
- Falls back to the first connection if no hint matches

### 3. Inject account info into system prompt
In the `fetchLiveServiceData` function, when building the context sections, list all connected accounts per service so the AI knows what's available. Example injection:
```
## Gmail Accounts
- colin@colinosborne.com (connection: 3bc12d3f)
- colin@ozlon.net (connection: 18e9357f)
Use the account the user specifies. Default to the first if unspecified.
```

### 4. Add `account` parameter to email tools
Add an optional `account` (email address hint) parameter to all email tool definitions: `list_emails`, `list_email_ids`, `get_email`, `send_email`, `create_email_draft`, `trash_email`, `batch_trash_emails`, `label_email`, `mark_email_read`. The AI will pass the email address from the user's message so the resolver picks the right connection.

### 5. Update `executeToolCall` 
In each email tool case, instead of `connMap.get('google-mail')`, call `resolveConnection(connMap, 'google-mail', args.account)` to get the correct connection ID.

### 6. Apply same pattern to other multi-connection services
Calendar, Drive, etc. also get the resolver treatment, future-proofing for multiple Google accounts.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/chat/index.ts` | Multi-connection map, resolver function, account-aware tool params, system prompt account listing |

## Result
When you say "pull my email from colin@ozlon.net", the AI passes `account: "colin@ozlon.net"` to the tool, the resolver matches it to connection `18e9357f`, and the correct inbox is used.

