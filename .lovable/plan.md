

# Dynamic, Context-Sensitive Account Resolution via Maton

## What Changes
Right now the system has hardcoded examples like "ozlon → colin@ozlon.net" in the prompt. Instead, the resolution should be fully dynamic — driven entirely by whatever accounts Maton reports as connected. When you add a new email tomorrow, it just works.

## Changes — `supabase/functions/chat/index.ts`

### 1. Auto-generate contextual keyword map from Maton connections
Instead of hardcoded keyword mappings, build them dynamically at request time from the connection list. For each connected account, extract:
- The full email address
- The email local part (e.g. `colin`)
- The domain name without TLD (e.g. `ozlon`, `colinosborne`)
- The full domain (e.g. `ozlon.net`)

This makes any new account instantly resolvable by partial name, domain, or full email — no code changes needed.

### 2. Enhance `resolveConnection` with auto-derived aliases
Update the partial matching to use the dynamically-built alias map. When a user says "scan my ozlon email" or "check colinosborne", the resolver matches against all derived aliases from every connected account, not a static list.

### 3. Make the system prompt fully dynamic
Replace the hardcoded examples in the MULTI-ACCOUNT INSTRUCTIONS with dynamically generated examples based on the actual connected accounts. For each account, auto-generate example phrases:
- `"[email]"` → exact match
- `"my [domain] email"` → domain alias
- `"[domain] gmail"` → domain + service keyword

This means if you connect `newclient@business.com` tomorrow, the AI immediately knows "my business email" refers to it.

### 4. Add the Context Resolution Rules as a permanent system prompt block
Inject the full resolution rules you provided (prioritize by context, check Maton first, don't default to easiest account, infer from conversation) as a dedicated system prompt section. But make the identity list within it dynamic — populated from whatever Maton returns, not hardcoded.

### 5. Update `injectMatonData` for multi-account awareness
When multiple accounts exist for a service and the user's message doesn't clearly specify one, instead of silently picking the first account's data, inject a brief summary of all accounts and let the AI decide or ask. When the user does specify (even implicitly via context keywords), inject only that account's data.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/chat/index.ts` | Dynamic alias generation, enhanced resolver, dynamic prompt examples, context resolution rules block, smarter injectMatonData |

## Result
- Any email connected through Maton is instantly addressable by full email, domain name, or partial alias
- No hardcoded account lists — adding a new connection "just works"
- The AI follows your context resolution rules: infer from conversation, check the right account through Maton first, only ask when truly ambiguous
- Saying "scan my ozlon inbox" or "check my business email" routes correctly based on what's actually connected

