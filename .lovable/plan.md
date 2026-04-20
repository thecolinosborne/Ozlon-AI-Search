
You approved Tool Sectioning v1, which delivered **failure isolation + domain telemetry** but kept all 259 tools in a single file and still loads them all per turn. The big wins from the original plan are still on the table:

## What's done
- Schema validator drops malformed tools instead of killing the whole toolset
- Per-request domain logging (visibility into what's loaded)
- All 259 tools currently valid

## What's NOT done (the actual token/accuracy wins)
- Tools still live in one 8,090-line file (no physical sectioning)
- Router still doesn't gate by domain — every turn ships all 259 tools to the model
- No per-domain failure isolation at load time

## Recommended next step: Tool Sectioning v2 — Router-Gated Loading

This is the high-impact half of the original plan:

**1. Tag every tool with a domain** (in-place, no file split yet)
```ts
{ name: 'gmail_search', domain: 'google-workspace', ... }
```
8 domains: `google-workspace`, `google-marketing`, `crm`, `projects`, `finance`, `memory`, `creative`, `system`

**2. Extend Infinity Router classification** to emit `domains: string[]`
Cheap Gemini Flash call already runs — add one field to its output.

**3. Gate `getValidatedTools()` by domain**
```ts
const domains = classification.domains ?? ALL_DOMAINS; // fallback = current behavior
const tools = validatedTools.filter(t => 
  t.domain === 'system' || domains.includes(t.domain)
);
```

**4. Safety net**: if router confidence < 0.5 OR classification fails → load all domains (current behavior). Zero regression risk.

### Expected impact
- ~60-70% fewer tool tokens per turn (259 → ~30-50 typical)
- Better model tool-selection accuracy (smaller menu)
- Faster first-token latency
- Foundation for v3 (physical file split) later, only if needed

### Out of scope
- No file split (defer until v2 proves the gating works)
- No UI changes
- No new tools
- No handler changes

### Files touched
- `supabase/functions/chat/index.ts` — add `domain` field to each tool entry, update `getValidatedTools()` to accept a domain filter, wire router output into the call site

Approve and I execute.
