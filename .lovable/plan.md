

## Universal API Key Input for All Integrations

### Problem
Each integration page expects API tokens to exist as backend env vars, but there's no way for you to enter them from the UI. ClickUp fails with "CLICKUP_API_TOKEN not configured," and other integrations have the same issue.

### Solution
Add API credential input fields to every integration detail page. When you enter credentials and click Connect, they get stored in the `integration_connections` table (already exists) and passed to edge functions on every request. Edge functions already support token overrides via params — we just need to wire the UI to send them.

### Changes by Integration

**1. ClickUp** — Add "API Token" input field. Pass `apiToken` in params (already supported by edge function). Store in `integration_connections`.

**2. Go High Level** — Add "API Key" and "Location ID" input fields. Update edge function to accept `apiKey` and `locationId` from params (fallback to env vars). Store in `integration_connections`.

**3. Descript** — Add "API Key" input field. Update edge function to accept token from params.

**4. Higgsfield** — Add "API Key" and "App ID" input fields. Update edge function to accept from params.

**5. Maton** — Add "API Key" input field. Update edge function/service to accept from params.

**6. YouTube** — Already has API key input. No changes needed.

**7. AI Processor** — No external API key needed (uses Lovable AI Gateway). No changes.

### How It Works

```text
User enters API key in UI
        ↓
Frontend stores in integration_connections table (metadata.api_key)
        ↓
On every API call, frontend reads stored key from Zustand/DB
        ↓
Passes key in request params to edge function
        ↓
Edge function uses params.apiKey || Deno.env.get('...')
```

### Files Changed

| File | Change |
|---|---|
| `src/pages/integrations/ClickUpDetail.tsx` | Add API Token input, pass in all calls |
| `src/pages/integrations/GoHighLevelDetail.tsx` | Add API Key + Location ID inputs, pass in calls |
| `src/pages/integrations/DescriptDetail.tsx` | Add API Key input, pass in calls |
| `src/pages/integrations/HiggsFieldDetail.tsx` | Add API Key + App ID inputs, pass in calls |
| `src/pages/integrations/MatonDetail.tsx` | Add API Key input, pass in calls |
| `supabase/functions/gohighlevel/index.ts` | Accept `apiKey`/`locationId` from params, fallback to env |
| `supabase/functions/descript/index.ts` | Accept `apiKey` from params, fallback to env |
| `supabase/functions/higgsfield/index.ts` | Accept `apiKey`/`appId` from params, fallback to env |
| `supabase/functions/maton/index.ts` | Accept `apiKey` from params, fallback to env |
| `src/components/integrations/ApiKeyInput.tsx` | Already exists — reuse for all pages |

### Security
- API keys stored in `integration_connections.metadata` (RLS-protected, per-user)
- Keys passed per-request to edge functions, never exposed in client-side storage
- Edge functions still fall back to env vars if no key is passed (backward compatible)

