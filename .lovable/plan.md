

## Upgrade to GPT-5.4

GPT-5.4 uses a **different API** than what your backend currently calls. Your backend uses `/v1/chat/completions` (Chat Completions API), but GPT-5.4 works best with the **Responses API** (`/v1/responses`). However, GPT-5.4 also works with the Chat Completions API — just with some limitations (no chain-of-thought passing between turns).

Since your app relies heavily on streaming SSE with Chat Completions format, the simplest path is to keep Chat Completions and just add GPT-5.4 as a model.

### Changes

**1. Edge function: `supabase/functions/chat/index.ts`**

Update the `MODEL_REGISTRY` to add GPT-5.4 and make it the default:

```text
MODEL_REGISTRY:
  'gpt-5.4' → name: 'gpt-5.4', endpoint: chat/completions, default
  'gpt-5'   → keep as-is (fallback)
  'gpt-5-mini' → keep as-is
  'gpt-4.1' → keep as-is

DEFAULT_MODEL = 'gpt-5.4'
```

GPT-5.4 works with Chat Completions — no API migration needed.

**2. Frontend: `src/core/ai/index.ts`**

Change `defaultAgentContext.model` from `'gpt-4.1'` to `'gpt-5.4'`.

**3. Frontend: `src/services/chatService.ts`**

- Add `'gpt-5.4'` to `AVAILABLE_MODELS`
- Change default `model` parameter in `streamChat` to `'gpt-5.4'`

**4. Frontend: `src/pages/integrations/AIProcessorDetail.tsx`**

Add `gpt-5.4` to the OpenAI models list in the UI.

**5. Update OPENAI_API_KEY secret**

Your existing `OPENAI_API_KEY` will be updated with the key you provided (the one you shared — you should rotate it after this since it was posted in plain text).

### What this gives you

- GPT-5.4 as the default model for all chat interactions
- Better coding, reasoning, tool use, and instruction following vs GPT-5
- 1M token context window support
- Backward compatibility — older models still selectable in AI Processor settings

### Not included (future upgrade)

- Migration to the Responses API (would enable chain-of-thought passing between turns for even better performance)
- GPT-5.4 specific features like `reasoning.effort`, `verbosity`, `phase`, computer use, tool search

