# Integration Contract — The Scalable Blueprint

Every integration is a **single manifest file** in `supabase/functions/_shared/integrations/`.
Adding Notion, Stripe, HubSpot, etc. = drop a file, register it. Zero edits to `chat/index.ts`.

## The 3 layers

```
┌──────────────────────────────────────────────────────────────┐
│ 1. MANIFEST (data only)                                      │
│    name · description · schema · action · envelope           │
│    + mapArgs       → translate AI args → API params          │
│    + formatter     → raw JSON → AI-friendly text             │
│    + sideEffect    → read | write | destructive | external   │
│    + cost          → free | cheap | moderate | expensive     │
│    + requiresConfirmation                                    │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 2. DISPATCHER (one file, never changes)                      │
│    routes → calls edge fn → runs formatter → telemetry       │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────┐
│ 3. EDGE FUNCTION (thin, per-integration)                     │
│    HTTP + auth + raw JSON. No formatting. No business logic. │
└──────────────────────────────────────────────────────────────┘
```

## Required fields

| Field         | Why                                                     |
| ------------- | ------------------------------------------------------- |
| `name`        | Stable AI-facing identifier                             |
| `description` | What/when to use it (the AI reads this)                 |
| `schema`      | JSON Schema for args validation                         |
| `action`      | What the receiver dispatches on                         |

## Recommended fields (these make scale work)

| Field                     | Why                                                              |
| ------------------------- | ---------------------------------------------------------------- |
| `mapArgs`                 | Keep AI args ergonomic; map to whatever the API actually wants   |
| `formatter`               | Kills format-regression. Use helpers from `_formatters.ts`       |
| `sideEffect`              | Drives auto-confirmation, parallel batching, audit log           |
| `cost`                    | Lets orchestrator decide whether to run speculatively / in parallel |
| `requiresConfirmation`    | Auto-true for `destructive`. Set true for any write you want gated |

## Formatter helpers

Use these instead of writing custom string concat:

```ts
import { formatList, formatRecord, formatReceipt, formatMetrics } from "./_formatters.ts";

formatter: (data) => formatList(data, "contacts",
  { title: "name", sub: "email", meta: "tags" },
  { label: "contacts", max: 25 })

formatter: (data) => formatReceipt(data, "Created task {name} (id: {id})")

formatter: (data) => formatMetrics(data,
  { Clicks: "totals.clicks", Impressions: "totals.impressions" })
```

Formatters MUST be pure and total: never throw, never call I/O, return `null` to fall back to JSON.

## Adding a new integration (5 minutes)

1. Create `supabase/functions/_shared/integrations/<name>.ts`:
   ```ts
   import type { IntegrationManifest } from "./types.ts";
   import { formatList } from "./_formatters.ts";

   export const myIntegration: IntegrationManifest = {
     id: "notion",
     displayName: "Notion",
     edgeFunction: "notion",          // existing or new edge fn
     envelope: "nested",              // { action, params }
     tools: [
       {
         name: "notion_list_pages",
         description: "List pages in a Notion database.",
         schema: { type: "object", properties: { database_id: { type: "string" } }, required: ["database_id"] },
         action: "list_pages",
         sideEffect: "read",
         cost: "cheap",
         formatter: (d) => formatList(d, "results",
           { title: "properties.Name.title.0.plain_text", sub: "url" }),
       },
     ],
   };
   ```

2. Register in `index.ts`:
   ```ts
   import { myIntegration } from "./notion.ts";
   export const INTEGRATIONS = [...existing, myIntegration];
   ```

3. Done. Tool is live, formatted, side-effect-aware, cost-tagged, and registered with the AI.

## Anti-patterns (do NOT do)

- ❌ Adding a `case "my_tool"` to `chat/index.ts`. Use the manifest.
- ❌ Custom string formatting inline in the edge function. Use a `formatter`.
- ❌ Skipping `sideEffect` on a write tool. The audit/confirm path needs it.
- ❌ Throwing inside a formatter. Return `null` to fall back to raw JSON.
- ❌ Putting auth logic in the manifest. That belongs in the edge function.

## Stability guarantees

- The **dispatcher signature is frozen.** Adding fields to `ToolManifest` is non-breaking
  (defaults applied in `index.ts` registry build).
- **Old manifests keep working** without `formatter`/`sideEffect`/`cost` (defaults: read · cheap · raw JSON).
- **Tool names are the public API to the AI.** Renaming a tool requires a deprecation alias.
