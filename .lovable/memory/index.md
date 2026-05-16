# Project Memory

## Core
- **Tech Stack:** Web+Capacitor (Zustand), Supabase (Postgres/pgvector), OpenAI (gpt-5.4 default, 1M context), Lovable AI Gateway.
- **Design Language:** Apple Vision Pro-inspired minimalist. Calm, translucent, generous spacing. No emojis ever. Jarvis/Batman tone.
- **Strict Constraints:** Additive development only. No UI rewrites or redesigns. Fixes must be surgical.
- **UI Architecture:** Voice-first. Unified ChatGPT-like page. No hardcoded chat action buttons.
- **Google Services:** Native Google edge functions only (Gmail, Drive, Calendar, Sheets, Docs, Slides, GSC, GA, Tag Manager, YouTube). Maton is REMOVED. Gmail scopes: readonly+send+modify+compose+labels+settings.basic. NEVER request `mail.google.com/` or `gmail.settings.sharing`. Never HTTP DELETE (use POST `/trash`). Return structured errors to AI.
- **State Management:** Strict data isolation (reset app store on user change). Complete reset on signout.
- **Forbidden Features:** Do not re-add Facebook Ads, Tasks, Video Studio, or Maton.
- **Both-Sides Rule:** When fixing/verifying anything that spans backend + frontend, always check BOTH sides before claiming done.

## Memories

- [Check both sides](mem://preferences/check-both-sides) — Always verify backend AND frontend on fix/verify requests

### Product & Design
- [Product summary](mem://product/system-definition-summary) — Ozlon is an AI Personal OS managing agents via voice/text
- [Voice-first UI](mem://product/voice-first-architecture) — Voice is primary input, large mic button hero element
- [Google-style home](mem://product/google-style-home-entry) — Guest-friendly centralized home screen
- [Visual language](mem://design/visual-language) — Apple Vision Pro minimalism, translucent cards, subtle motion
- [Micro-interactions](mem://design/micro-interactions) — Breathing orb, pulsing mic, smooth transitions
- [App shell layout](mem://navigation/app-shell-layout) — Sticky backdrop-blur header, BottomNav
- [Aesthetic and tone](mem://design/aesthetic-and-tone) — Calm, wise, concise (Batman/Jarvis). No emojis.
- [Chat input design](mem://chat/input-area-design) — Auto-resizing unified composer with attachment chips
- [Unified chat interface](mem://architecture/unified-chat-home-interface) — Hero hides on interaction to maximize chat vertical space

### Authentication & Onboarding
- [Auth strategy](mem://auth/signup-authentication-strategy) — Supabase RLS, email/password + Google, guest mode allowed
- [Auth context](mem://auth/single-source-of-truth-context) — Centralized AuthContext prevents stale state
- [Auth header states](mem://ui/auth-state-header-rendering) — 3 header states based on loading/session
- [Signout reset](mem://auth/signout-complete-reset) — Complete teardown sequence to prevent data leaks
- [Onboarding flow](mem://onboarding/conversational-flow) — 3-step: Welcome, Naming, Completion
- [Onboarding routing](mem://onboarding/signup-flow-routing) — New users directly to onboarding, returners to chat
- [Onboarding once](mem://onboarding/run-once-per-account) — Prevents returning users from repeating flow
- [System identity](mem://personalization/system-identity) — OS custom name set in onboarding becomes wake word
- [Voice narration](mem://onboarding/voice-narration-full-flow) — Synthetic orb narrates onboarding flow

### Chat & AI Behavior
- [Guided expert persona](mem://chat/guided-expert-persona) — Line-by-line technical explanation
- [Settings-driven behavior](mem://ai/global-behavior-settings-driven) — AI respects user toggles (voice, integrations, OS name)
- [Personalization requirements](mem://chat/personalization-requirements) — Address user and assistant by chosen names
- [Orb greeting behavior](mem://chat/orb-greeting-behavior) — System name intro only at first interaction
- [Interface design philosophy](mem://chat/interface-design-philosophy) — No hardcoded action buttons on messages
- [Session management](mem://chat/session-management-ui) — Multi-session sidebar grouped by date
- [Action execution](mem://chat/action-execution-engine) — Non-streaming tool loop for GHL + native Google actions
- [Agent execution constraint](mem://backend/agent-execution-constraint) — `enableTools: true` required for backend actions
- [Error reporting](mem://chat/error-reporting-policy) — Handlers return detailed structured errors, no swallowing
- [List-confirm-act](mem://interaction/list-confirm-act-protocol) — Ask for explicit user confirmation before destructive actions
- [Response architecture](mem://chat/response-architecture) — 5-question backbone + 3 shells (Execution / Advisory / Default), omit-by-default, single confidence register
- [Long-form engine](mem://chat/long-form-engine) — Detects teleprompter/speech/essay requests, injects length-contract prompt + bumps token budget (16k→48k tiered). Overrides brevity rules so 15-min teleprompter actually delivers ~2,250 words.

### Voice Input & Output
- [Whisper STT](mem://voice/whisper-transcription-integration) — Supabase Edge Function to Whisper API
- [Transcription review](mem://voice/transcription-review-before-send) — Text lands in input field, no auto-send
- [ElevenLabs TTS](mem://voice/tts-output-via-elevenlabs) — Auto-play toggle, playback buttons on messages
- [Standard Aria voice](mem://voice/tts-standard-aria-voice) — Default voice ID for all TTS
- [TTS fallback](mem://architecture/tts-fallback-strategy) — Automatic fallback to OpenAI TTS on ElevenLabs failure
- [Voice cloning](mem://voice/voice-cloning-feature) — Custom ElevenLabs cloned voices collected in onboarding
- [Real-time voice mode](mem://voice/realtime-voice-chat-mode) — gpt-5.4-realtime (OpenAI reasoning + ElevenLabs synthesis)
- [Voice mode gating](mem://voice/voice-mode-authentication-gating) — Voice features require auth and voice_enabled toggle
- [Chat/Voice toggle](mem://ui/chat-voice-mode-toggle) — Switch between text and fullscreen real-time voice mode

### Architecture & Stability
- [Web+Capacitor framework](mem://architecture/web-plus-capacitor-rebuild) — Zustand global state, centralized callbacks
- [God Mode OS framework](mem://architecture/god-mode-orb-os-framework) — Modular multi-agent orchestrator with 12 defaults
- [Intent-based routing](mem://architecture/intent-based-agent-routing) — Dispatcher for CHECK_MONEY, CHECK_MAIL, etc.
- [OpenAI multi-model](mem://backend/openai-multi-model-architecture) — Default gpt-5.4 via Chat Completions
- [Infinity Router](mem://architecture/infinity-router-orchestration) — 6-path Gemini pre-processing layer
- [Lovable AI gateway](mem://infrastructure/lovable-ai-gateway) — Centralized LLM endpoint via LOVABLE_API_KEY
- [Chat state stability](mem://architecture/chat-session-state-stability) — 3-layer state model, visibility latch for async handoffs
- [Conversation persistence](mem://architecture/conversation-persistence-strategy) — Local SQLite cache + Supabase pgvector
- [User data isolation](mem://architecture/user-session-data-isolation) — Global app store reset on user ID change
- [Deterministic routes](mem://architecture/deterministic-route-logic) — Terminal states (loading, error, empty, loaded) required
- [Authenticated tools](mem://architecture/authenticated-tool-auth-flow) — Pass JWT to edge functions for user context
- [Per-user credentials](mem://architecture/per-user-integration-credentials) — All integration keys per-user in integration_connections (RLS)
- [Storage privacy](mem://architecture/storage-privacy) — generated-images/videos buckets are private; signed URLs (7-day TTL); media-signed-url function refreshes expired URLs
- [Realtime + service writes](mem://architecture/realtime-and-service-writes) — Realtime topics must be uid-prefixed; task_events/model_routing_log/routine_runs are intentionally service-role-only writes
- [Native Google OAuth](mem://integrations/native-google-oauth) — All Google services use direct OAuth via _shared/google-token.ts (Maton permanently removed)
- [Additive development](mem://constraints/additive-development-policy) — Preserve all existing UI/UX when adding features
- [Stabilization policy](mem://architecture/stabilization-policy) — No broad refactors, isolated lifecycle fixes only
- [Removed features](mem://features/removed-tasks-and-video-studio) — Tasks, Video Studio, Facebook Ads, Maton removed permanently
- [Signal envelope](mem://architecture/signal-envelope) — 5-bucket signal model + 8-level priority hierarchy. Pure builder, sliced renderers, trie-cached entities. Generalizes per-integration account binding.

### Integrations Hub & Services
- [Hub visual identity](mem://integrations/hub-visual-identity) — Vercel/Stripe aesthetic for modular integration cards
- [Hub redesign](mem://integrations/hub-redesign) — Zustand-managed `/integrations` for 3rd-party sync settings
- [Testing mode](mem://constraints/testing-mode-live-actions) — Live actions (create/update/delete) explicitly permitted for dev
- [File attachments](mem://input/file-attachment-system) — 10 files, 20MB max. Metadata passed to backend
- [Google Drive links](mem://preferences/google-drive-link-conversion) — Auto-convert view links to export=download
- [Event research](mem://features/event-research-architecture) — Tavily + Firecrawl scraping into `discovered_events`
- [Sentient SEO](mem://features/sentient-seo-intelligence) — GSC snapshots + web_search_google cross-referencing
- [GoHighLevel support](mem://integrations/gohighlevel-tier-3-support) — 50+ tools including Social Planner, Products, Contacts
- [GHL account memory](mem://integrations/ghl-account-resolution) — Sub-account resolution: explicit > session (chat_sessions) > user default (profiles) > metadata fallback
- [ClickUp workspace](mem://integrations/clickup-workspace-discovery) — API-driven Space/Folder/List picker, overrides env vars
- [AI Processor registry](mem://integrations/ai-processor-registry) — Live verification of provider API keys
- [Higgsfield pack](mem://features/higgsfield-pack-orchestration) — 9-skill Higgsfield AI pack (SOUL, HEX, moodboard, Sora 2, Seedance, DoP, Popcorn, multi-scene) wired through `_shared/integrations/higgsfield.ts`
- [Marketing pack orchestration](mem://features/marketing-pack-orchestration) — 11 marketing skills + orchestrator that routes via wisdom memory and learns from each route
- [Slack multi-tenant OAuth](mem://integrations/slack-multi-tenant-oauth) — Per-user "Add to Slack" install; tokens stored in integration_connections, events routed by team_id

### Google Services & Email (Native)
- [Account resolution](mem://integrations/identity-context-resolution-rules) — Hierarchy: explicit -> contextual -> inferred
- [Email management](mem://features/email-management-system) — Native Gmail edge function, multi-account, newest-first default
- [Email reference ledger](mem://integrations/email-reference-ledger) — Validates message ID against session before destructive actions
- [Gmail deletion policy](mem://integrations/gmail-deletion-policy) — HTTP DELETE forbidden, use POST /trash
- [Gmail scope bundle](mem://features/gmail-scope-bundle) — Full Gmail scopes (read/send/modify/compose/labels/settings.basic) + orchestration flow
- [Gmail restricted scopes](mem://constraints/gmail-restricted-scopes) — Never request mail.google.com or gmail.settings.sharing

### Wisdom Engine (Memory)
- [Living memory architecture](mem://architecture/wisdom-engine-living-memory) — pgvector tables: knowledge_entries, wisdom_memories, reflection_notes
- [Wisdom Engine constraints](mem://ai/wisdom-engine-identity-constraints) — Emulates reasoning, prioritizes user sovereignty, doesn't claim sentience
- [Starter wisdom pack](mem://knowledge/starter-wisdom-pack) — 50+ universal principles embedded
- [Wisdom sources](mem://knowledge/wisdom-engine-sources) — 18+ high-profile frameworks (Hormozi, Munger, etc.)
- [Skill learning](mem://wisdom/automatic-skill-learning) — Implicit post-turn extraction and `save_memory` tool (>0.9 similarity)
- [Evolution proposals](mem://features/wisdom-engine-evolution-proposals) — Pending state for AI-suggested memory/logic reorganizations
- [Skill loop](mem://architecture/skill-loop) — Phase 1 meta-skill: silent observation capture into reflection_notes + cross_cutting_principles table; reuses system_evolution_proposals for Phase 3
