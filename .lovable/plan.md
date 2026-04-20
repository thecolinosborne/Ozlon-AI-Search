
Executing **A then C**: physical file split first, then fix the two audit failures.

## Phase A: Tool Sectioning v3 — Physical File Split

Split the 8,090-line `supabase/functions/chat/index.ts` into a domain-organized module tree. Zero behavior change — registry produces the same `ACTION_TOOLS` array v2 already gates on.

### New structure
```
supabase/functions/chat/
  ├── index.ts                 (orchestrator, ~800 lines: serve handler, streaming, router wiring)
  ├── tools/
  │   ├── registry.ts          (loads all domains, runs validator, exports getValidatedTools)
  │   ├── types.ts             (ToolDef, Domain, Handler types)
  │   ├── google-workspace.ts  (gmail, calendar, drive, docs, sheets, slides)
  │   ├── google-marketing.ts  (gsc, ga4, tag-manager, youtube)
  │   ├── crm.ts               (gohighlevel — largest domain)
  │   ├── projects.ts          (clickup, work_tasks)
  │   ├── finance.ts           (plaid)
  │   ├── memory.ts            (knowledge, wisdom, save_memory)
  │   ├── creative.ts          (descript, higgsfield, image-gen, video-gen, viral-creative)
  │   └── system.ts            (web_search, time, user_context — always-on)
  └── handlers/
      └── (one file per domain mirroring tools/, exports a handler map)
```

### Each domain file shape
```ts
// tools/google-workspace.ts
export const domain = 'google-workspace' as const;
export const tools: ToolDef[] = [ /* gmail_search, calendar_create, ... */ ];

// handlers/google-workspace.ts
export const handlers: Record<string, ToolHandler> = {
  gmail_search: async (args, ctx) => { ... },
  ...
};
```

### Registry
```ts
// tools/registry.ts
import * as gw from './google-workspace.ts';
import * as crm from './crm.ts';
// ...
const ALL = [gw, crm, /* ... */];
export const ACTION_TOOLS = ALL.flatMap(d => d.tools.map(t => ({ ...t, domain: d.domain })));
export const HANDLERS = Object.assign({}, ...ALL.map(d => d.handlers));
```

`getValidatedTools()` and the v2 domain-gating logic stay in `index.ts` and consume `ACTION_TOOLS` from the registry. **No logic changes** — purely a file move.

### Risk controls
- Move tools one domain at a time, deploy + smoke-test between each
- Keep validator on; if any domain file has a syntax error it isolates to that domain
- Compare tool count before/after at each step (must stay 259)

## Phase C: Fix audit FAILs (after A is green)
1. **ClickUp `create_task`** — register the missing tool entry in `tools/projects.ts` and wire its handler
2. **Soft-delete sync** — when a `work_task` is deleted, exclude it from chat session context queries (filter `deleted_at IS NULL`)

## Out of scope
- No router changes (v2 stays)
- No new tools beyond ClickUp `create_task`
- No UI changes

## Files touched
- `supabase/functions/chat/index.ts` (shrinks dramatically)
- `supabase/functions/chat/tools/*.ts` (new)
- `supabase/functions/chat/handlers/*.ts` (new)
- `supabase/functions/chat/tools/projects.ts` (Phase C: add create_task)
- Chat context query (Phase C: filter deleted tasks)

Approve and I execute Phase A first, verify, then Phase C.
