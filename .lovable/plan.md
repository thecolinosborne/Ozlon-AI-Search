

## Fix YouTube Integration (and other non-working APIs)

### Root Cause
The `youtube` edge function is **missing from `supabase/config.toml`**. Without an explicit entry, the gateway defaults to `verify_jwt = true` and may silently reject or fail to route requests before your function code even runs — explaining zero logs and the infinite spinner.

Additionally, the `maton`, `gohighlevel`, and `youtube` functions all need config entries to work reliably.

### Changes

**1. Add missing functions to `supabase/config.toml`**

Add these entries:
```toml
[functions.youtube]
verify_jwt = false

[functions.maton]
verify_jwt = false

[functions.gohighlevel]
verify_jwt = false
```

The YouTube function handles its own auth internally (`getAuthedUserId`), so `verify_jwt = false` is correct — it still validates the user's JWT in code.

**2. Redeploy the YouTube function**

Force a fresh deployment so the new config takes effect.

**3. Clean up the two internal "Supabase" comments** (from the earlier approved plan)

- `src/contexts/AuthContext.tsx` line 66: change comment to `// Load user profile from backend`
- `src/services/chatService.ts` line 154: change comment to `// Timeout getSession to prevent hanging when backend is slow/unreachable.`

### What This Fixes
- YouTube "Connect" button will stop spinning infinitely
- API key test will return success/failure instead of hanging
- OAuth authorize flow will work
- Any other integrations using edge functions that were missing from config will also start working

### No Other Files Changed
The YouTube edge function code and frontend code are already correct — the only issue is the missing config entry blocking requests from reaching the function.

