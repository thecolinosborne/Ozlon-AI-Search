---
name: Signal Envelope architecture
description: 5-bucket signal model (intent, context, importance, confidence, interaction) with 8-level priority hierarchy. Pure builder in _shared/signals/, sliced renderers per consumer, trie-cached entity matcher.
type: feature
---

## Why
Replace ad-hoc per-integration context-binding (originally only in chat for GHL) with a generic, scalable signal layer that all consumers (chat, signals-synthesize, voice) can read.

## Buckets
- A. **Intent** — ask | decide | write | execute | fix | plan
- B. **Context** — entities/accounts in scope (ghl, clickup, gmail, etc.)
- C. **Importance** — urgent | recurring | revenue | personal | strategic | blocking
- D. **Confidence** — confirmed | likely | inferred | missing
- E. **Interaction** — concise | deep | advisory | action-first

## Priority hierarchy (within each bucket)
direct → active → durable → contextual → recent → inferred → background → uncertain

## Files
- `supabase/functions/_shared/signals/types.ts` — Signal, SignalEnvelope, PRIORITY_ORDER
- `supabase/functions/_shared/signals/builder.ts` — pure `buildSignalEnvelope()` + `pickAccountByPriority()`
- `supabase/functions/_shared/signals/entities.ts` — trie matcher, per-user cached (5min TTL)
- `supabase/functions/_shared/signals/intent|importance|interaction.ts` — deterministic classifiers
- `supabase/functions/_shared/signals/render.ts` — `renderForChatPrompt({topN})`, `renderForVoice()`, `renderForUI()`

## Scaling rules
- Envelope is NEVER serialized whole into a prompt. Each consumer picks one renderer.
- Entity matcher is O(text length), not O(accounts × text), via per-user trie.
- Adding a new bucket = additive field, no migration.
- Adding a new consumer = import builder + a renderer, zero changes to other consumers.

## Wired consumers
- `supabase/functions/chat/index.ts` — appends `renderForChatPrompt(env, {topN:3})` after GHL resolution; uses `pickAccountByPriority(env, 'ghl')` to detect priority drift.
- `supabase/functions/signals-synthesize/index.ts` — accepts optional `envelope` in POST body; appends to system prompt so synthesis aligns with the user's current intent and in-scope account.
- `src/components/RealtimeVoiceChat.tsx` — seeds realtime session on connect via client-side `renderForVoiceClient()` (mirror of server `renderForVoice`). One-line context, sent once per session.

## Next consumers (when needed)
- Chat → pass its built envelope to `signals-synthesize` invocations so reactive synthesis is aligned with the active turn (currently synthesize falls back to context-only).
- Communications surface for inbox-side priority filtering.
