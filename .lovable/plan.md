

## Lock Down Integrations: Per-User API Key Storage

### Problem
All integrations (ClickUp, Maton, GHL, Descript, Higgsfield) use shared server-level environment secrets. Any signed-up user gets access to your ClickUp workspace, your Gmail via Maton, your GHL CRM, etc.

### Solution
Follow the pattern already established by the YouTube integration: store each user's API keys in the `integration_connections` table (per-user, RLS-protected), and make edge functions resolve credentials from the calling user's record instead of env vars.

### Architecture

```text
User signs up → goes to /integrations → enters their own API keys
    ↓
Keys stored in integration_connections table (user_id scoped, RLS protected)
    ↓
Edge functions receive JWT → resolve user_id → look up that user's credentials
    ↓
No env var fallback for user-facing calls (env vars only for webhook callbacks)
```

### Changes

**1. Edge Functions — Add per-user credential lookup (6 files)**

Each integration edge function gets a `getUserCredential(userId, provider)` helper that:
- Queries `integration_connections` where `user_id = userId` and `provider = 'clickup'` (etc.)
- Returns the API key from `metadata.api_key`
- Throws "not configured" if missing
- Falls back to env vars ONLY for webhook-initiated calls (no user context, e.g. ClickUp webhook)

Files:
- `supabase/functions/clickup/index.ts` — `getToken()` checks JWT user first, env fallback only for webhooks
- `supabase/functions/gohighlevel/index.ts` — resolve GHL key + location from user's `integration_connections`
- `supabase/functions/maton/index.ts` — resolve Maton key from user's record
- `supabase/functions/descript/index.ts` — resolve Descript key from user's record
- `supabase/functions/higgsfield/index.ts` — resolve App ID + API key from user's record
- `supabase/functions/chat/index.ts` — the big one: resolve Maton, GHL, ClickUp keys from the authenticated user's `integration_connections` instead of env vars

**2. Frontend Integration Detail Pages — Save keys to database (5 files)**

Update each detail page's "Save API Key" handler to upsert into `integration_connections` instead of just Zustand:

- `src/pages/integrations/ClickUpDetail.tsx` — upsert `{ provider: 'clickup', metadata: { api_key } }`
- `src/pages/integrations/GoHighLevelDetail.tsx` — upsert `{ provider: 'gohighlevel', metadata: { api_key, location_id } }`
- `src/pages/integrations/MatonDetail.tsx` (already shown) — upsert `{ provider: 'maton', metadata: { api_key } }`
- `src/pages/integrations/DescriptDetail.tsx` — upsert `{ provider: 'descript', metadata: { api_key } }`
- `src/pages/integrations/HiggsFieldDetail.tsx` — upsert `{ provider: 'higgsfield', metadata: { app_id, api_key } }`

YouTube already does this correctly — no changes needed there.

**3. Shared helper for edge functions**

Create a reusable `getUserIntegrationKey` function used across all edge functions:

```typescript
async function getUserIntegrationKey(
  supabase: SupabaseClient,
  userId: string,
  provider: string,
  field = 'api_key'
): Promise<string> {
  const { data } = await supabase
    .from('integration_connections')
    .select('metadata')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('status', 'connected')
    .single();
  if (!data) throw new Error(`${provider} not configured for this user`);
  const key = (data.metadata as Record<string, string>)?.[field];
  if (!key) throw new Error(`${provider} API key not found`);
  return key;
}
```

**4. Chat edge function credential isolation**

The `chat/index.ts` function (5138 lines) currently pulls `MATON_API_KEY` and `GHL_API_KEY` from env. Update it to:
- Extract user ID from the Authorization header (already done for message persistence)
- Look up that user's Maton and GHL keys from `integration_connections`
- If the user has no keys, those integrations simply aren't available to them (tools won't be offered)

**5. Webhook exception handling**

ClickUp webhooks arrive without user auth. For these, keep the env var fallback but scope it: the webhook handler uses `team_id` to look up the owner from `clickup_integration_state`, then fetches that user's credentials from `integration_connections`.

### What stays the same
- Database schema — `integration_connections` table already exists with the right columns
- RLS policies — already scoped to `auth.uid() = user_id`
- YouTube integration — already follows this pattern
- Env var secrets — remain as fallback for your account during transition, but new users must provide their own

### Security outcome
- New users see empty integration pages, must enter their own keys
- Your keys are stored in your `integration_connections` records, inaccessible to others via RLS
- The chat AI only has access to integrations the authenticated user has configured
- Webhook callbacks resolve the integration owner's keys from the database

