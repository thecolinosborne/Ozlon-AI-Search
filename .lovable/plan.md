
User has two asks:
1. Confirm it's safe to regenerate (rotate) the ClickUp API token. Old one isn't retrievable (correct — vault is one-way, ClickUp itself only shows tokens once).
2. Ensure all ClickUp edge function hooks (the AI tools that talk to ClickUp from chat) work bidirectionally — AI → ClickUp actions and ClickUp → AI (webhooks/inbound).

Quick context check:
- We just patched `supabase/functions/clickup/index.ts` with vault-first resolver. Need to confirm chat function's ClickUp tools route through the same resolver (or invoke the `clickup` function with proper auth so vault read works).
- Also need to verify webhook callback path still works after the resolver change (it uses `tokenOverride` from stored config — already kept for back-compat per memory).

Plan:

### 1. Answer the rotation question (chat reply, no code)
Yes — rotate freely. ClickUp only shows tokens at creation. Our vault stores it encrypted and we can't decrypt for display either (only `last4` is shown). After rotating in ClickUp, paste the new token in `/integrations/clickup` → it dual-writes to vault + metadata, and `vault_store` audit row + new `last4` will appear.

### 2. Audit ClickUp hooks for bidirectional AI access

Read-only inspection of:
- `supabase/functions/chat/index.ts` — find every ClickUp tool handler. Confirm each one either:
  (a) invokes the `clickup` edge function with the user's `Authorization` header forwarded (so vault resolver runs), OR
  (b) reads the token directly via the same vault-first chain.
- `supabase/functions/clickup/index.ts` — confirm webhook inbound path (ClickUp → us) still resolves credentials via `tokenOverride` from stored webhook config (no user JWT available on inbound webhooks).
- `src/core/agents/index.ts` and any ClickUp tool registration — confirm tool schemas are wired to chat.

### 3. Fix any gaps found

Likely fixes (will confirm during audit):
- If chat function's ClickUp tools call `clickup` edge function without forwarding the user's JWT → patch to forward `Authorization` header so vault read works for that user.
- If any ClickUp tool still reads `Deno.env.get("CLICKUP_API_TOKEN")` directly → route through the unified `resolveClickUpToken` path.
- If webhook handler path lost its `tokenOverride` lookup during the recent patch → restore it.

### 4. Verify end-to-end after fixes
- User rotates token in ClickUp → pastes in `/integrations/clickup` → I query `credential_audit_log` for new `vault_store` + new `last4`.
- User asks the AI in chat: "list my ClickUp spaces" → I check chat edge logs + `credential_audit_log` for a `vault_read` row triggered by the chat function.
- Inbound webhook (if configured) → confirm webhook path still resolves via stored config.

### Files likely touched
- `supabase/functions/chat/index.ts` — forward JWT to clickup invocation, or inline vault resolver for ClickUp tools
- (Possibly) `supabase/functions/clickup/index.ts` — only if webhook path regressed

### Out of scope
- No UI changes
- No changes to other integrations (Descript/YouTube already done; Higgsfield/GHL still pending in their own steps)
