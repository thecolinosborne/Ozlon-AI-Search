

## GPT-5.4 Integration Audit & Completion

### Status: GPT-5.4 is working
The chat edge function is confirmed using `gpt-5.4-2026-03-05` and streaming responses correctly.

### Remaining old model references to update

| File | Current Model | Change To |
|------|--------------|-----------|
| `supabase/functions/chat/index.ts` line 3230 | `gpt-4.1-2025-04-14` (deep research synthesis) | `gpt-5.4` |
| `supabase/functions/chat/index.ts` line 4083 | `gpt-4.1-nano-2025-04-14` (memory extraction) | `gpt-5.4` |
| `supabase/functions/clickup/index.ts` line 230 | `gpt-5` (ClickUp AI comments) | `gpt-5.4` |
| `supabase/functions/knowledge-ingest/index.ts` line 31 | `gpt-4.1-2025-04-14` (knowledge processing) | `gpt-5.4` |
| `supabase/functions/realtime-session/index.ts` line 31 | `gpt-4o-realtime-preview-2024-12-17` (voice) | **Keep as-is** — this is the Realtime API, GPT-5.4 doesn't have a realtime variant yet |
| `src/hooks/useRealtimeVoice.ts` line 231 | `gpt-4o-realtime-preview-2024-12-17` (voice WebRTC) | **Keep as-is** — same reason |
| `src/pages/integrations/AIProcessorDetail.tsx` line 12 | Description says "GPT-4.1, GPT-5, GPT-5 Mini" | Update to "GPT-5.4, GPT-5, GPT-5 Mini" |
| `src/pages/integrations/AIProcessorDetail.tsx` line 43 | Test uses `gpt-5-mini` for verification | Update to `gpt-5.4` |

### What stays unchanged
- **Realtime voice** (`gpt-4o-realtime-preview`) — GPT-5.4 doesn't have a realtime WebSocket variant; this is a separate product
- **Model registry** in `chat/index.ts` — older models kept as fallback options, GPT-5.4 is already the default

### Changes
1. Update 4 hardcoded model strings in edge functions to `gpt-5.4`
2. Update AI Processor UI description and test model
3. Redeploy affected edge functions (`chat`, `clickup`, `knowledge-ingest`)

