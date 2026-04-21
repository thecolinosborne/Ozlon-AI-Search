

## Scalable Tool Routing — Make Adding Integrations a 30-Second Job

### Your question, plainly

> "Can this scale to hundreds of integrations where one voice command fans out to many tools, and adding a new one is trivial?"

**Today: no.** Each integration is hand-wired in 3+ places (`chat/index.ts` switch, `NATIVE_GOOGLE_ROUTES`, tool defs, frontend detail page). Adding YouTube Shorts publishing means editing the chat function, redeploying, and hoping nothing breaks. That doesn't scale past ~20 integrations.

**After this plan: yes.** Add an integration by writing one manifest file. Chat function picks it up automatically. One voice command can fan out to N tools in parallel.

### The architecture shift (still surgical, no rewrites)

**1. Integration manifest registry** — single source of truth

Each integration becomes one file: `supabase/functions/_shared/integrations/<name>.ts` exporting:

```ts
export const youtubeIntegration: IntegrationManifest = {
  id: "youtube",
  edgeFunction: "youtube",
  envelope: "nested",  // or "flat" — handles the bug we just fixed, permanently
  authResolver: "google-oauth",  // or "per-user-key" | "env" | "oauth-custom"
  tools: [
    {
      name: "youtube_upload_video",
      description: "Upload a video to the user's YouTube channel.",
      schema: { /* JSON schema */ },
      action: "upload_video",
      mapArgs: (args) => ({ ...args }),
    },
    // ... more tools
  ],
};
```

The chat function imports a barrel `_shared/integrations/index.ts` that aggregates all manifests. Tool list, dispatcher routes, and envelope handling are all generated from the registry at boot. **No more editing `executeToolCall` to add tools.**

**2. Universal dispatcher** replaces the current `tryNativeGoogleCall` + giant switch

```ts
async function dispatchTool(toolName, args, userId, jwt) {
  const route = TOOL_REGISTRY.get(toolName);  // built from manifests at boot
  if (!route) return { success: false, result: `Unknown tool: ${toolName}` };
  const payload = route.envelope === "nested"
    ? { action: route.action, params: route.mapArgs(args) }
    : { action: route.action, ...route.mapArgs(args) };
  return await callEdge(route.edgeFunction, payload, jwt);
}
```

This permanently kills the envelope-mismatch class of bugs (the `docs_insert_text` failure you keep hitting).

**3. Parallel fan-out for "speak once → do many"**

New tool: `multi_action` that takes an array of tool calls and runs them concurrently with `Promise.allSettled`. Example voice command:

> "Post the new product to Instagram via GHL, schedule a YouTube Short, draft a Gmail to the launch list, and add a row to the launch tracker sheet."

The AI emits one `multi_action` call with 4 sub-calls. Dispatcher runs them in parallel, returns a structured report (3 succeeded, 1 failed with reason). Latency = slowest single call, not sum.

**4. Frontend auto-discovery**

Currently every integration needs its own `*Detail.tsx`. New approach: a generic `IntegrationDetailLayout` (already exists) reads the manifest's UI block (`{ icon, displayName, fields, testAction }`) and renders the page. New integration = no new React file unless it has unusual UI needs.

### What ships in this implementation pass

**Phase 1 — Foundation (this PR, ~4 files)**
- `_shared/integrations/types.ts` — `IntegrationManifest` + `ToolManifest` types
- `_shared/integrations/index.ts` — registry barrel that aggregates manifests
- `_shared/integrations/_dispatcher.ts` — universal `dispatchTool` with envelope handling, JWT forwarding, structured errors
- Migrate **5 existing integrations** to manifests as proof: `google-docs`, `google-sheets`, `google-calendar`, `gohighlevel`, `clickup`
- Wire `chat/index.ts` to: (a) build tool list from registry, (b) route through `dispatchTool` first, (c) fall back to legacy switch for not-yet-migrated ones (descript, search-atlas, plaid, etc. — migrate in Phase 2)

**Phase 2 — Migrate the rest (follow-up, no plan needed)**
- Move remaining edge functions to manifests one by one. Each migration is ~30 lines and removes ~50 lines of switch-case bloat. Net code shrinks.

**Phase 3 — `multi_action` tool**
- Add the parallel fan-out tool definition + executor in `chat/index.ts` (~40 lines).
- AI prompt gets one new instruction: *"For multi-step requests, prefer `multi_action` over sequential calls."*

### Files touched this pass

- **New**: `supabase/functions/_shared/integrations/types.ts`, `index.ts`, `_dispatcher.ts`, `google-docs.ts`, `google-sheets.ts`, `google-calendar.ts`, `gohighlevel.ts`, `clickup.ts`
- **Edited**: `supabase/functions/chat/index.ts` — wire registry + dispatcher, add `multi_action`, fix the existing envelope bug as part of the dispatcher (so `docs_insert_text` works), keep legacy switch as fallback for unmigrated tools.
- **Verified, not edited**: `google-docs/index.ts`, `google-sheets/index.ts`, `google-calendar/index.ts` — confirm they accept `{ action, params }` (they do).

### Verification

1. Curl chat with `docs_insert_text` → 200 + text actually inserted in target doc.
2. Curl chat with `multi_action` containing `[gmail_send, sheets_append_row, ghl_create_contact]` → all three execute in parallel, structured per-tool result returned.
3. Voice test in preview: *"Send a test email to me, log it in my CRM, and add it to today's tracker sheet"* → AI emits one `multi_action`, all three complete.
4. Add a throwaway 6th manifest (`example_ping`) to prove zero-config registration works → tool appears in AI's tool list on next chat without touching `chat/index.ts`.

### Out of scope this pass

- No new integrations beyond the 5 migrated ones (descript, search-atlas, GA4, GTM stay on legacy path until Phase 2).
- No DB changes, no new secrets, no UI redesign of the integrations hub.
- No changes to voice/realtime layer — it already calls the chat function so it inherits everything.
- No changes to GHL or ClickUp tool *definitions* — only how they're wired (functionally identical).

### Why this is the right scaling move (and not over-engineering)

- **Adds an abstraction only where you have repetition** — 4 integrations was fine, 14+ is where hand-wiring breaks down.
- **Backwards compatible** — legacy switch stays until each function is migrated. Nothing breaks during transition.
- **Permanently kills the envelope-bug class** — every future integration uses one dispatcher with explicit `envelope` field, no more silent param-drop failures.
- **Unlocks "speak once → do many"** via `multi_action`, which is the user-facing capability you're describing.
- **Frontend stays declarative** — manifests carry UI metadata, so adding an integration doesn't require a new React file.

### After Phase 1, adding a new integration looks like this

1. Write `_shared/integrations/notion.ts` manifest (~40 lines).
2. Drop in `supabase/functions/notion/index.ts` edge function (or use connector gateway).
3. Done. Tools appear in chat, hub page renders automatically, voice can call them.

That's the scalability you're asking for.

