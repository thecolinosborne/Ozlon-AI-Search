## Problem

The chat tool loop in `supabase/functions/chat/index.ts` calls OpenAI directly via `MODEL_REGISTRY` (line 57–90) with a single endpoint and a single API key. When OpenAI returns `429 insufficient_quota` (or any non-transient error), there is no fallback — the function throws "AI service error" and the user sees a dead chat.

Today's behavior:
- Retries 429/502/503/504 three times against the **same** model (line 8033–8061).
- No provider switch. No model switch. Hard fail on `insufficient_quota` because OpenAI returns 429 with a body that means "you're out of money," not "slow down" — retrying never helps.
- The Lovable AI Gateway (`LOVABLE_API_KEY`) is already configured and used elsewhere in the same file (line 8450), but the main tool loop ignores it.

## Goal

Chat should **never lapse** because one provider/key is degraded. The tool loop must auto-rotate through a priority-ordered list of providers/models until one succeeds, while preserving tool-calling behavior.

## Plan

### 1. Define a failover chain (`MODEL_REGISTRY` upgrade)

Replace the single `ModelConfig` per id with an ordered `fallbacks: ModelConfig[]` array. Each entry carries: endpoint, key env var, model name, supports_tools.

Default chain for `gpt-5.4` (priority order — try top-down):

```
1. openai-direct     → api.openai.com         OPENAI_API_KEY      gpt-5.4
2. lovable-gateway   → ai.gateway.lovable.dev LOVABLE_API_KEY     openai/gpt-5.4
3. lovable-gateway   → ai.gateway.lovable.dev LOVABLE_API_KEY     openai/gpt-5
4. lovable-gateway   → ai.gateway.lovable.dev LOVABLE_API_KEY     google/gemini-3-flash-preview
5. lovable-gateway   → ai.gateway.lovable.dev LOVABLE_API_KEY     google/gemini-2.5-flash
```

Same chain reused for `gpt-5`, `gpt-5-mini`, `gpt-4.1` with their own top entries. All chains terminate in the Gemini fallback so chat is alive as long as **either** OpenAI billing or Lovable AI works.

### 2. Classify errors (don't retry the unretryable)

Introduce `classifyError(status, bodyText)`:
- `transient` → 502/503/504, plain 429 without "insufficient_quota". Retry on **same** entry with backoff (existing logic).
- `quota` → 429 with `insufficient_quota`/`exceeded_quota`, or 402. Skip remaining attempts on this entry; advance to next chain entry immediately.
- `auth` → 401/403, or missing API key. Advance to next entry.
- `bad_request` → 400. Don't fail over (it's our payload). Throw.
- `unknown` → other 5xx. One retry on same entry, then advance.

### 3. New helper: `callModelWithFallback(chain, body, signal)`

Wrap the existing fetch+retry block (line 8033–8061) into a function that:
1. Iterates `chain` in priority order.
2. For each entry: resolve API key, build endpoint-appropriate `model` field, attempt up to 3 retries on transient errors.
3. On `quota`/`auth`/exhausted retries → log `[failover] model=X reason=Y → trying next` and continue.
4. On success → return `{ response, modelUsed, attempts, failoverPath }`.
5. If the entire chain fails → throw with the last error and a structured summary.

Telemetry is logged so we can confirm failovers happened in edge logs.

### 4. Wire it into the tool loop

Replace lines 8033–8061 in `supabase/functions/chat/index.ts` with `callModelWithFallback(chainFor(modelId), { messages, tools, tool_choice, max_completion_tokens })`. Tool-calling payload stays identical — both OpenAI and the Lovable gateway accept the same OpenAI-compatible `tools`/`tool_choice` schema, so Gemini-via-gateway also gets tools.

### 5. Surface attribution to the UI (small, additive)

When the chosen entry isn't the primary, append a structured SSE event before `[DONE]`:

```
event: model_failover
data: { from: "gpt-5.4@openai", to: "openai/gpt-5.4@lovable", reason: "quota" }
```

The frontend already handles custom SSE events (`research_artifact`). A tiny pill in the message footer reads "served via Lovable AI" so the user knows their account didn't actually break. (No design change beyond an existing-style chip.)

### 6. Verification

- Force-fail OpenAI by temporarily setting `OPENAI_API_KEY=invalid` in a curl test against `/functions/v1/chat`; confirm the response still streams via the Gemini fallback.
- Inspect edge logs for `[failover]` lines confirming the path taken.
- Confirm tool calls still execute end-to-end through the Lovable gateway.

## Out of scope

- No changes to `personal_research`, embeddings paths, or post-turn memory extraction (separate follow-up; same pattern can be reused).
- No new secrets — `LOVABLE_API_KEY` is already configured.
- No UI redesign — only the small failover chip.

## Files touched

- `supabase/functions/chat/index.ts` — registry → chains, new `callModelWithFallback`, replace tool-loop fetch block, emit `model_failover` SSE event.
- `src/services/chatService.ts` + `src/hooks/useChatStream.ts` — parse `model_failover` event onto the message.
- `src/components/chat/MessageBubble.tsx` — render small "served via {provider}" chip when present.
