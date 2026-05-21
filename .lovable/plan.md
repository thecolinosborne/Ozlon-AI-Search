## Problem

`higgsfield_generate_image` fails with "prompt missing" even though the AI passes a prompt. The image never generates.

## Root cause (surgical, one-line)

Envelope mismatch between the manifest and the receiver:

- **Manifest** `supabase/functions/_shared/integrations/higgsfield.ts` declares `envelope: "nested"`, so the universal dispatcher sends:
  ```json
  { "action": "generate_image", "params": { "prompt": "...", "aspect_ratio": "16:9" } }
  ```
- **Receiver** `supabase/functions/higgsfield/index.ts` (line 120) destructures **flat**:
  ```ts
  const { action, apiKey, appId, ...params } = body;
  ```
  With a nested payload, `params` becomes `{ params: { prompt: "..." } }`, so `const { prompt } = params` on line 149 is `undefined` → Higgsfield API rejects with "prompt required".

This is the same envelope bug class the dispatcher comment warns about. Same root cause applies to `generate_video`, `get_job_status`, and `cancel_job` — none of them work today via chat.

## Fix

Change one line in `supabase/functions/_shared/integrations/higgsfield.ts`:

```diff
- envelope: "nested",
+ envelope: "flat",
```

The receiver already uses the flat shape (`{ action, ...params }`), matches other flat integrations (descript, gohighlevel, communications, viral-creative, search-atlas).

## Verification

1. Redeploy `chat` edge function (dispatcher pulls manifest at module load).
2. Ask the assistant to generate a Higgsfield image — expect a `request_id`.
3. Confirm `higgsfield_job_status` poll returns the completed URL.
4. Check edge logs: `[dispatcher] higgsfield_generate_image → higgsfield/generate_image OK`.

## Scope guarantees

- Backend only, 1-line manifest change.
- No UI, no schema, no API key, no other handlers touched.
- No effect on any other integration (envelope is per-manifest).
