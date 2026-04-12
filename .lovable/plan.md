

# Infinity Router — Implementation Plan

## Overview
Add a non-invasive intelligence orchestrator to the `chat` edge function that classifies requests and optionally pre-processes via Gemini (Lovable AI Gateway) before the existing OpenAI flow runs. Disabled by default via feature flags.

## Step 1: Add Secrets
Store two feature flag secrets:
- `INFINITY_ROUTER_ENABLED` → `"true"` (enabled for immediate testing)
- `INFINITY_ROUTER_DEBUG` → `"true"` (enabled for immediate testing)

`LOVABLE_API_KEY` already exists for Gemini calls via Lovable AI Gateway.

## Step 2: Add Router to Edge Function
**File: `supabase/functions/chat/index.ts`**

Insert ~180 lines **before** the `serve()` handler (around line 3329). The router code is fully isolated:

**a) Classifier** — pure logic function analyzing the last user message:
```typescript
interface ClassifierOutput {
  intent: string;
  task_type: string;
  input_length: number;
  has_files: boolean;
  file_types: string[];
  needs_memory: boolean;
  needs_multimodal: boolean;
  needs_live_data: boolean;
  needs_deep_reasoning: boolean;
  confidence: number;
}
```
Uses keyword heuristics (no API call). Detects memory keywords, analysis patterns, long input, file references.

**b) Route Scorer** — weighted scoring across 6 paths:
| Signal | Path | Weight |
|--------|------|--------|
| input > 8000 chars | gemini_flash | +3 |
| file/multimodal keywords | gemini_pro | +4 |
| simple short question | default_chat | +5 |
| memory/remember keywords | retrieval | +4 |
| API/service keywords | action | +5 |
| analysis/synthesis | gemini_pro | +3 |
| low confidence | default_chat | +3 |

Highest wins. Ties → `default_chat`. `retrieval` and `action` paths just confirm the existing system handles it (no behavior change).

**c) Gemini Pre-processor** — only runs for `gemini_flash`/`gemini_pro` paths:
- Calls Lovable AI Gateway (`google/gemini-2.5-flash` or `google/gemini-2.5-pro`)
- Sends user input with a task-specific prompt (summarize/extract/analyze)
- Returns enriched context string

**d) Router wrapper** — 5-line addition inside `serve()` handler (after request parsing, before system prompt build ~line 3366):
```typescript
// Infinity Router - additive pre-processing
const routerEnabled = Deno.env.get('INFINITY_ROUTER_ENABLED') === 'true';
if (routerEnabled) {
  try {
    const enrichment = await runInfinityRouter(messages, Deno.env.get('INFINITY_ROUTER_DEBUG') === 'true');
    if (enrichment) systemPrompt += enrichment;
  } catch (e) { console.error('[InfinityRouter] Fallback to default:', e); }
}
```

Any failure → silently skipped, existing flow runs unchanged.

**e) Debug logging** — when `INFINITY_ROUTER_DEBUG` is true, emits an SSE event `infinity_router_debug` with path chosen, scores, and timing. The existing `chatService.ts` already handles unknown event types gracefully (ignores them).

## Step 3: Frontend Debug Panel
**New file: `src/components/InfinityRouterDebug.tsx`**

Small panel showing:
- Router enabled/disabled status
- Last selected path + reason
- Scores breakdown
- Execution time
- Fallback triggered or not

Reads from a state store that captures the debug SSE event.

**Edit: `src/pages/Developer.tsx`**

Import and render the debug panel at the bottom of the page.

## Step 4: Handle Debug Events in Chat Service
**Edit: `src/services/chatService.ts`**

Add handling for `infinity_router_debug` event type in the SSE parser (similar to existing `task_update` handling). Store in a lightweight global/ref for the debug panel.

## What Does NOT Change
- chatService.ts streaming logic (additive only)
- AI service layer (`src/core/ai/`)
- Orchestrator, stores, existing components
- Memory/Wisdom Engine
- Maton/tool integrations
- Any existing routes, pages, or UI

## Fallback Guarantees
- Feature flag off → zero code paths execute
- Classifier error → skip, run existing
- Gemini call fails → skip enrichment, run existing
- Scoring returns no winner → default_chat
- User never sees router errors

