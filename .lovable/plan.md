# Plan: Split `chat/index.ts` into per-domain modules

**Goal:** reduce the 10.8K-line monolith into focused files without changing behavior, request/response shape, tool names, or UI. Pure refactor — additive moves only.

## Why now
- Cold-start risk grows with file size.
- Drift between `ACTION_TOOLS`, the switch, and tier maps is easier to introduce than catch.
- New integrations land faster when domain handlers live next to their manifests.

## Target structure

```text
supabase/functions/chat/
  index.ts                  # HTTP entry, auth, request parsing, response shaping (~400 lines)
  loop/
    runToolLoop.ts          # the tool-call loop, parallel exec, per-turn cache
    registryDriftCheck.ts   # boot-time sanity check (already written, just move)
    toolDefs.ts             # builds OpenAI tool list from manifests + legacy ACTION_TOOLS
    tiers.ts                # tier gating + cost classification
  domains/
    gmail.ts                # all gmail_* handlers
    ghl.ts                  # all ghl_* handlers
    clickup.ts              # clickup_* handlers
    google.ts               # docs/sheets/slides/drive/calendar/analytics/gtm
    research.ts             # web_search, firecrawl, tavily, extract
    media.ts                # higgsfield, descript, viral-creative
    memory.ts               # save_memory, wisdom lookups
    communications.ts       # digest + comms
    misc.ts                 # everything else not yet categorized
  context/
    buildSystemPrompt.ts    # persona, identity, settings injection
    buildHistory.ts         # session load, summarization, attachments
  format/
    (already exists)        # router.ts, cards.ts — leave in place
```

Each `domains/*.ts` exports a single `handle(toolName, args, ctx): Promise<ToolResult>` plus an exported `OWNS: string[]` array of tool-name prefixes/exact names it serves. `runToolLoop` dispatches by walking the domain modules — no giant switch.

## Migration steps (each shippable independently, no behavior change)

1. **Scaffold + lift utilities.** Create `loop/`, `domains/`, `context/` folders. Move pure helpers (`runRegistryDriftCheck`, tier maps, prompt builders) out of `index.ts`. Re-export from old paths to keep imports stable. Verify with `deno check` + a smoke chat request.
2. **Extract `runToolLoop` into `loop/runToolLoop.ts`.** Keep the per-turn cache and `Promise.all` parallelism intact. `index.ts` just calls it.
3. **Carve domain modules one at a time**, in this order (smallest blast radius first): `memory` → `research` → `media` → `communications` → `google` → `clickup` → `ghl` → `gmail`. After each carve: deploy, run a real chat hitting that domain, check logs.
4. **Replace the central switch** with a domain-map lookup once all domains are moved. Keep a fallback branch that logs `[dispatch-miss]` for one week before deleting.
5. **Tighten the drift check** to also verify every `ACTION_TOOLS` entry resolves to a domain module (catches future drift at boot).

## Guardrails

- No tool renamed, no schema changed, no edge function boundary changed.
- Every step deploys green before the next starts.
- Registry drift check stays gating (boot fails loud if a tool has no handler).
- Add one new Deno test per domain that asserts `OWNS` matches what the domain's `handle` actually accepts.

## Out of scope (explicitly)

- No UI changes.
- No new features, tools, or models.
- No changes to Maton gateway, manifests, or front-end services.
- No splitting of `chat/index.ts`'s HTTP contract — same URL, same payload.

## Estimated effort
~6 focused passes, each ~20–40 min including deploy + smoke. Total ~3–4 hours of agent time, spread across sessions so each lands verified.

Say the word and I'll start with step 1 (scaffold + lift utilities).