
Yes — this folds into the Gauntlet plan and actually simplifies it. The user-facing surface becomes one toggle: **Auto** (default, system picks per task) vs **Manual** (power-user override). Most people never touch it.

## The Auto Router (the brain inside the Gauntlet)

Every DAG node gets scored across 5 dimensions, the router picks the stone with the best fit-to-cost ratio, falls back automatically on failure. Deterministic, sub-10ms, no extra LLM call for routing.

### Scoring dimensions per node
| Dimension | Source | Example |
|---|---|---|
| **complexity** | planner emits `low / medium / high` | multi-step reasoning → high |
| **modality** | task type | `vision`, `image_gen`, `text`, `audio` |
| **latency_priority** | user context | voice mode → fast; background → relaxed |
| **context_size** | tokens estimated | >200k → only Gemini Pro / GPT-5 |
| **cost_sensitivity** | user tier + run budget | free user → prefer cheaper stones |

### Stone capability matrix (seed values, tunable)
```text
Stone              reasoning  vision  image  speed  cost   max_ctx
─────────────────────────────────────────────────────────────────
Lovable Gateway    8          7       9      7      $      1M
OpenAI gpt-5       10         9       —      6      $$$$   400k
OpenAI gpt-5-mini  8          8       —      9      $$     400k
Gemini 2.5 Pro     9          10      —      7      $$$    2M
Gemini 2.5 Flash   7          8       —      10     $      1M
Gemini Nano Banana —          —       10     8      $$     —
Anthropic Sonnet   9          8       —      7      $$$    200k
```

### Routing function (pseudocode)
```text
score(stone, node) =
    capability_match(stone, node.modality) * 3
  + reasoning_fit(stone, node.complexity) * 2
  + speed_fit(stone, node.latency_priority) * 1
  - cost_penalty(stone, user.cost_sensitivity)
  - context_overflow_penalty(stone, node.context_size)

pick = argmax(active_stones, score)
fallback_chain = sorted(active_stones - pick, score desc)
```

### Auto mode UX
- One toggle on the AI Gauntlet panel: **Auto (recommended)** ↔ **Manual**
- In Auto: user sees nothing — just gets results. Optional "why this stone?" chip on each AI response that expands to show the routing reason (e.g. "Picked Gemini Flash: fast classification, low cost").
- In Manual: existing per-task model dropdown returns for power users.
- Default for all users: **Auto**.

### Telemetry feedback loop (lightweight, additive)
New table `gauntlet_routing_log`:
```text
id, user_id, run_id, node_type, modality, complexity,
chosen_stone, fallback_used (bool), latency_ms,
success (bool), cost_estimate, created_at
```
Used for:
1. Showing the user's "stone usage breakdown" on the panel (Gemini 60%, OpenAI 25%, Lovable 15%)
2. Future: tune the scoring weights from real outcomes (out of scope for this build, but the data lands now)

## Updated build (delta vs the previous Gauntlet plan)

### Same as before
- `ai_providers` table + RLS
- `gauntlet-router` edge function with 4 drivers (Lovable, OpenAI, Gemini, Anthropic)
- Frontend panel under `/integrations/ai-processor` with stone slots
- `GEMINI_API_KEY` secret request (only new secret needed)
- Wire orchestrator to call gauntlet-router for inference

### New / changed for Auto mode
- **Router is the default path.** Manual override is opt-in, not the entry point.
- Add `mode` field to `ai_providers` settings: `'auto' | 'manual'`. Default `'auto'`.
- Add scoring function `pickStone(needs, activeStones)` inside `gauntlet-router/index.ts` (~80 lines, pure function, unit-testable).
- Add `gauntlet_routing_log` table + RLS.
- Add "why this stone" tooltip data to the gauntlet-router response (`{ stone, reason, fallback_used }`) so frontend can surface it.
- Panel shows usage breakdown chart (reuse existing `chart.tsx` from shadcn).

### Files touched (final list)

**New:**
- `supabase/functions/gauntlet-router/index.ts` (router + 4 drivers + scoring fn)
- `supabase/migrations/<ts>_ai_providers_and_routing_log.sql`
- `src/components/gauntlet/GauntletPanel.tsx`
- `src/components/gauntlet/StoneSlot.tsx`
- `src/components/gauntlet/AutoModeToggle.tsx`
- `src/components/gauntlet/UsageBreakdown.tsx`
- `src/hooks/useGauntlet.ts`

**Modified (surgical, additive):**
- `supabase/functions/orchestrator/index.ts` — call gauntlet-router, default Auto
- `supabase/functions/chat/index.ts` — opt-in Auto routing for chat too (default off this build to avoid regression; flip on after smoke tests pass)
- `src/pages/integrations/AIProcessorDetail.tsx` — embed `GauntletPanel`
- `supabase/config.toml` — register `gauntlet-router`

**Untouched:** all 259 chat tools, voice, onboarding, auth, integrations UI.

## Verification (full 13-item checklist, unchanged + 4 new)
1-9. Original chat / integration / Phase C smoke tests (must all PASS)
10. All 4 stones appear, status reflects active keys
11. Auto picks correct stone for: text Q (→ Flash), code reasoning (→ gpt-5), vision (→ Gemini Pro), image gen (→ Nano Banana)
12. Fallback test: kill OpenAI mid-run → router auto-routes to Gemini, completes
13. Hot-swap test: add new key → stone lights up <5s, no reload
14. **NEW:** Auto/Manual toggle works; Manual restores per-task dropdown
15. **NEW:** "Why this stone?" tooltip shows reason on AI responses
16. **NEW:** Usage breakdown chart populates after 5+ runs
17. **NEW:** Routing log table receives entries with correct user_id under RLS

## Build order
1. Request `GEMINI_API_KEY` (one prompt)
2. Migration: `ai_providers` + `gauntlet_routing_log` + RLS
3. `gauntlet-router` edge function (drivers + scoring + verify endpoint)
4. Orchestrator → gauntlet-router wiring
5. Frontend: `GauntletPanel`, `AutoModeToggle`, `UsageBreakdown`, `StoneSlot`
6. Embed in `AIProcessorDetail`
7. Run all 17 verification items, paste results table

Approve and I execute. Auto-mode is the default — user never has to think about which stone is firing unless they want to.
