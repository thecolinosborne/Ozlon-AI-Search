
User approved. Plan is already clear from prior turns — present concise build plan and stop.

Scope: one shared registry file, one router, wire into chat planner+executor, one settings page, one DB migration. Defaults preserve current behavior (zero regression).

# Infinity Gauntlet — Build Plan

## 1. Database (one migration)
- `user_model_preferences` — `user_id`, `mode` ('speed'|'balanced'|'quality', default 'balanced'), `agent_overrides` jsonb, `disabled_models` text[]. RLS: own rows only.
- `model_routing_log` — `user_id`, `agent`, `model_used`, `latency_ms`, `success`, `fallback_used`, `created_at`. RLS: own rows readable, insert via service role.

## 2. Shared registry — `supabase/functions/_shared/model-registry.ts`
- `MODEL_REGISTRY`: every model = `{id, gateway, contextWindow, costPer1kIn/Out, avgLatencyMs, capabilities[], enabled, fallback}`. Seeded with current Lovable AI models (Gemini family, GPT-5 family).
- `AGENT_REGISTRY`: `planner`, `executor`, `classifier`, `summarizer` — each declares `preferredTier`, `requires[]`, hard fallback.
- `pickModel(agent, userPrefs, disabledModels)` — scores eligible models, returns `{primary, fallbackChain[]}`.
- `callWithFallback(messages, agent, userPrefs)` — tries primary → walks chain on 429/402/5xx/timeout → logs to `model_routing_log`.

## 3. Wire into `supabase/functions/chat/index.ts`
- Replace hardcoded planner model call with `callWithFallback(..., 'planner', prefs)`.
- Replace hardcoded executor model call with `callWithFallback(..., 'executor', prefs)`.
- Load `user_model_preferences` once per request (cached). Defaults = current models if no row.
- ~30 lines changed. Existing prioritizer, two-pass routing, semantic booster — all untouched.

## 4. Settings UI — new page `src/pages/ModelRouting.tsx` + route in `App.tsx`
- Three-mode segmented control: **Speed / Balanced / Quality** (writes `mode`)
- Per-agent override dropdowns (planner, executor, etc.) — "Auto" by default
- Model toggle list with capability badges and live cost-per-turn estimate
- Entry point: new `SettingsRow` in `Settings.tsx` under a new "Intelligence Routing" section, icon `Zap`

## 5. Telemetry visibility
- Same page shows last 24h: avg latency per agent, fallback rate, model usage breakdown — feeds Phase 5 self-evolution later.

## Safety
- Defaults match current behavior (planner=`gemini-2.5-flash-lite`, executor=`openai/gpt-5`)
- Fallback chain is purely additive — today there is none
- `requires: ['tools']` flag prevents weak-tool-calling models from ever being picked for executor
- No integration code touched. No tool registry touched. Two-pass flow preserved.

## Files touched
- New: `supabase/migrations/<timestamp>.sql`, `supabase/functions/_shared/model-registry.ts`, `src/pages/ModelRouting.tsx`
- Edited: `supabase/functions/chat/index.ts` (~30 lines), `src/App.tsx` (route), `src/pages/Settings.tsx` (one row)

## Effort
~1 session. Ship-ready.
