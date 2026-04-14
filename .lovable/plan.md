

## Update Realtime Voice to GPT-5.4

OpenAI's Realtime API now supports GPT-5.4 via the model identifier `gpt-5.4-realtime`. This replaces the old `gpt-4o-realtime-preview-2024-12-17` model in both the session creation endpoint and the WebRTC connection.

### Changes

**1. Edge function: `supabase/functions/realtime-session/index.ts`**
- Line 31: Change model from `gpt-4o-realtime-preview-2024-12-17` to `gpt-5.4-realtime`

**2. Frontend: `src/hooks/useRealtimeVoice.ts`**
- Line 231: Change model from `gpt-4o-realtime-preview-2024-12-17` to `gpt-5.4-realtime`

**3. Redeploy** the `realtime-session` edge function.

Two files changed, two lines each. GPT-5.4 will now power all voice conversations with its improved reasoning and instruction-following capabilities, while the hybrid architecture (OpenAI for STT + reasoning, ElevenLabs for TTS output) remains intact.

