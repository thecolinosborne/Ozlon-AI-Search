

# Infinity Router — Implementation Plan

## What It Does

Adds a lightweight **preflight decision layer** at the top of the existing `chat` edge function. Before the current system runs, it classifies the request and optionally pre-processes via Gemini (through Lovable AI Gateway) to enrich context. The existing flow is untouched — Gemini output gets injected as additional system prompt context, then the normal OpenAI pipeline runs as-is.

## Architecture

```text
User Message → Feature Flag Check
                    │
              (disabled) → Existing flow (zero changes)
              (enabled)  → Classify → Score → Route
                                                │
                    ┌───────────────────────────┤
                    │                           │
              default_chat              gemini_flash / gemini_pro
              (skip, run existing)      (pre-process via Lovable AI Gateway,
                                         inject result as context,
                                         then run existing flow)
```

## Files Changed

| File | What |
|------|------|
| `supabase/functions/chat/index.ts` | Add ~180 lines at top: classifier, scorer, Gemini pre-processor. Wrap the serve handler entry with a 5-line feature flag check |
| `src/components/InfinityRouterDebug.tsx` | New — small debug panel component |
| `src/pages/Developer.tsx` | Add debug panel import + render |

## No Files Modified Otherwise

chatService.ts, AI service layer, stores, existing components — all untouched.

## Secrets Needed

- `INFINITY_ROUTER_ENABLED` — stored as secret, value "false" (disabled by default)
- `INFINITY_ROUTER_DEBUG` — stored as secret, value "false"
- `LOVABLE_API_KEY` — already available (used for Gemini calls via Lovable AI Gateway)

No need to store your raw Gemini API key — we use the Lovable AI Gateway which has LOVABLE_API_KEY auto-provisioned.

## Implementation Details

### 1. Preflight Classifier (pure logic, no API call)
Analyzes the last user message to produce:
```typescript
{ intent, task_type, input_length, has_files, file_types,
  needs_memory, needs_multimodal, needs_live_data,
  needs_deep_reasoning, confidence }
```
Uses keyword detection + heuristics (similar to existing `detectServiceIntents`).

### 2. Route Scorer (weighted)
Six paths scored with weights:
- `input_length > 8000` → gemini_flash +3
- `has_files / multimodal keywords` → gemini_pro +4
- `simple question (short, no special signals)` → default_chat +5
- `memory keywords` → retrieval +4 (triggers existing Wisdom Engine, no change)
- `action/API keywords` → action +5 (triggers existing tool loop, no change)
- `analysis/synthesis keywords` → gemini_pro +3
- `low confidence` → default_chat +3 (fallback)

Ties → default_chat. Retrieval and action paths don't change existing behavior — they just confirm the existing system will handle it.

### 3. Gemini Pre-Processor
Only runs for `gemini_flash` or `gemini_pro` paths. Calls Lovable AI Gateway (`google/gemini-2.5-flash` or `google/gemini-2.5-pro`) with the user's input + a task-specific prompt (summarize, extract, analyze). Injects the result as an additional system prompt section. Then the normal OpenAI flow runs with enriched context.

### 4. Fallback
Any error in classifier, scorer, or Gemini call → silently skip, run existing flow. No user-facing errors.

### 5. Debug Panel
Small component on Developer page showing last router decision (path chosen, reason, timing). Reads from a custom SSE event `infinity_router_debug` sent only when debug mode is on.

## Steps

1. Add `INFINITY_ROUTER_ENABLED` and `INFINITY_ROUTER_DEBUG` secrets (both "false")
2. Add router code to `supabase/functions/chat/index.ts` (isolated section before serve handler)
3. Add 5-line wrapper in the serve handler that checks feature flag and runs router
4. Create `src/components/InfinityRouterDebug.tsx`
5. Add debug panel to `src/pages/Developer.tsx`
6. Deploy edge function

