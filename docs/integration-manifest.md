# Integration Manifest System

This project uses a **registry-driven** architecture for AI-callable integrations. Adding a new third-party service should take ~30 seconds of wiring (plus whatever the underlying edge function needs).

There are **two registries** that work together:

| Registry | Purpose | Path |
| --- | --- | --- |
| Backend (chat tools) | Exposes tools to the AI; routes tool calls to edge functions with the correct envelope | `supabase/functions/_shared/integrations/` |
| Frontend (UI) | Lists integrations on the hub; auto-renders detail pages | `src/integrations/registry.ts` |

---

## 1. Backend manifest (tool routing)

### Files
- `_shared/integrations/types.ts` — `IntegrationManifest` + `ToolManifest` types
- `_shared/integrations/index.ts` — barrel that aggregates every manifest
- `_shared/integrations/_dispatcher.ts` — universal `dispatchTool` + `dispatchMulti`
- `_shared/integrations/<name>.ts` — one file per integration

### Manifest shape

```ts
import type { IntegrationManifest } from "./types.ts";

export const notionIntegration: IntegrationManifest = {
  id: "notion",
  displayName: "Notion",
  edgeFunction: "notion",       // → supabase/functions/notion/index.ts
  envelope: "nested",            // "nested" → { action, params: {...} }
                                 // "flat"   → { action, ...params }
  tools: [
    {
      name: "notion_create_page",       // tool name AI sees
      description: "Create a new page in Notion.",
      action: "create_page",            // dispatched to edge function
      schema: {                         // OpenAI JSON schema
        type: "object",
        properties: {
          parentId: { type: "string" },
          title: { type: "string" },
        },
        required: ["parentId", "title"],
      },
      // Optional. Default: pass-through.
      mapArgs: (a) => ({ parentId: a.parentId, title: a.title }),
    },
  ],
};
```

### Register the manifest

Add two lines in `_shared/integrations/index.ts`:

```ts
import { googleDocsIntegration } from "./google-docs.ts";
import { googleSheetsIntegration } from "./google-sheets.ts";
import { googleCalendarIntegration } from "./google-calendar.ts";
import { googleSlidesIntegration } from "./google-slides.ts";
import { googleDriveIntegration } from "./google-drive.ts";
import { googleAnalyticsIntegration } from "./google-analytics.ts";
import { googleTagManagerIntegration } from "./google-tag-manager.ts";
import { descriptIntegration } from "./descript.ts";
import { searchAtlasIntegration } from "./search-atlas.ts";
import { notionIntegration } from "./notion.ts";

export const INTEGRATIONS: IntegrationManifest[] = [
  googleDocsIntegration,
  googleSheetsIntegration,
  googleCalendarIntegration,
  googleSlidesIntegration,
  googleDriveIntegration,
  googleAnalyticsIntegration,
  googleTagManagerIntegration,
  descriptIntegration,
  searchAtlasIntegration,
  notionIntegration,
];
```

That's it. The chat function:
1. Adds every tool from every manifest to the OpenAI tool list.
2. Routes tool calls through `dispatchTool` first.
3. Falls back to the legacy switch only for tools not in the registry.

### Envelope rule

Look at how the receiving edge function reads its body:

```ts
// nested receivers (all current Google services, Descript v2):
const { action, params = {} } = await req.json();

// flat receivers (legacy):
const { action, ...rest } = await req.json();
```

Set `envelope` accordingly. **Mismatched envelopes silently drop params** — this was the entire class of bugs that prompted this refactor.

### Multi-action (parallel fan-out)

The chat function exposes a built-in `multi_action` tool the AI uses to run independent calls concurrently:

```jsonc
{
  "name": "multi_action",
  "args": {
    "calls": [
      { "name": "gmail_send", "args": { "to": "x@y.com", "subject": "Hi" } },
      { "name": "sheets_append_rows", "args": { "spreadsheetId": "...", "values": [["a","b"]] } },
      { "name": "ghl_create_contact", "args": { "firstName": "Z" } }
    ]
  }
}
```

Latency = slowest call, not sum. Falls through to legacy executor for tools not yet migrated.

---

## 2. Frontend manifest (hub + detail pages)

### File
`src/integrations/registry.ts` — exports `INTEGRATIONS` array.

### Manifest shape

```ts
{
  id: "notion",
  name: "Notion",
  description: "Notes, docs, and team wiki.",
  icon: BookOpen,                         // lucide-react icon
  category: "productivity",               // hub filter bucket
  provider: "notion",                     // integration_connections.provider
  fnName: "notion",                       // edge function for "Test connection"
  testAction: "list_databases",
  testLabel: "Databases",
  auth: "api-key",                        // "google-oauth" | "api-key" | "none"
  customDetailPage: false,                // true ⇒ skip auto-renderer
}
```

### What you get for free
- Card on `/integrations` (filtered by category, status, search).
- Detail page at `/integrations/notion` rendered by `AutoIntegrationDetail`:
  - Connection status badge (live from `integration_connections`).
  - "Test connection" button that calls `fnName/testAction`.
  - Sync runs list (where applicable).

### When to use a custom detail page
Set `customDetailPage: true` and add an explicit route in `src/App.tsx` **before** the catch-all when the integration needs:
- Bespoke OAuth bootstrap UI (every Google service).
- Webhook subscription management (ClickUp).
- Sub-account picker (GoHighLevel).
- Plaid Link or any other 3rd-party SDK launcher.

---

## 3. End-to-end checklist for a new integration

1. **Edge function** (`supabase/functions/<name>/index.ts`) — accepts `{ action, params }` (nested) or `{ action, ...rest }` (flat). Auto-deploys.
2. **Backend manifest** (`_shared/integrations/<name>.ts`) — declare tools.
3. **Register** in `_shared/integrations/index.ts`.
4. **Frontend manifest entry** in `src/integrations/registry.ts`.
5. *(Optional)* Custom `*Detail.tsx` if `customDetailPage: true`.

Done — chat picks up the tools, the hub shows the card, voice can call them, `multi_action` can fan out to them.

---

## 4. Verification recipes

```bash
# Single registered tool:
POST /chat  { messages: [{ role: "user", content: "List my Google Docs." }], enableTools: true }

# Parallel fan-out:
POST /chat  { messages: [{ role: "user", content:
  "Use multi_action to: list my calendars, list my sheets, and get my drive quota." }],
  enableTools: true }
```

Check logs:
```
supabase edge_function_logs chat --search "[dispatcher]"
```
Successful routes log `[dispatcher] <tool> → <fn>/<action> OK`.
