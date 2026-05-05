## 1. Fix GA4 `ga4_run_report` / `ga4_realtime_report` schema mismatch

**Root cause:** The manifest in `supabase/functions/_shared/integrations/google-analytics.ts` exposes flat fields (`propertyId`, `startDate`, `endDate`, `dimensions`, `metrics`, `limit`) to the AI, but its `mapArgs` passes them through unchanged. The edge function `supabase/functions/google-analytics/index.ts` expects a nested `report` object containing GA4's `dateRanges`, `dimensions`, `metrics`, `limit`. Result: every call returns `"report object is required"`.

**Fix (manifest only — edge function stays as the canonical GA4 shape):**

In `_shared/integrations/google-analytics.ts`, update `mapArgs` for the two report tools to build the GA4 payload from the flat inputs:

- `ga4_run_report.mapArgs(a)` returns:
  ```
  {
    propertyId: a.propertyId,
    report: {
      dateRanges: [{ startDate: a.startDate, endDate: a.endDate }],
      dimensions: (a.dimensions ?? []).map(name => ({ name })),
      metrics:    (a.metrics    ?? []).map(name => ({ name })),
      ...(a.limit ? { limit: a.limit } : {}),
    }
  }
  ```
- `ga4_realtime_report.mapArgs(a)` returns:
  ```
  {
    propertyId: a.propertyId,
    report: {
      dimensions: (a.dimensions ?? []).map(name => ({ name })),
      metrics:    (a.metrics    ?? []).map(name => ({ name })),
    }
  }
  ```

Also accept an already-nested `report` passthrough so the AI can send raw GA4 JSON if it wants:
- If `a.report` is provided, use it as-is and only forward `propertyId` + `report`.

**Optional formatter** (small, additive): add a `formatter` for `ga4_run_report` that flattens `rows[]` into `{ dimensions: {...}, metrics: {...} }` plus a `totals` summary so the AI gets clean tabular data instead of GA4's verbose envelope. Falls back to default JSON if shape is unexpected.

No edge function change, no new tools, no schema field renames — the AI keeps using the documented flat schema.

## 2. Easy-to-copy prompt / code / text blocks in chat

**Where:** `src/components/chat/MessageBubble.tsx` (assistant markdown branch only — user bubbles untouched).

**Changes:**

1. Add a small `CopyButton` subcomponent (icon-only, `Copy` → `Check` for 1.5s on success, uses `navigator.clipboard.writeText`, calm Vision-Pro styling: `bg-card/60 backdrop-blur` border, `opacity-0 group-hover:opacity-100` reveal, top-right absolute).

2. Override `ReactMarkdown` `components` for:
   - **`pre`**: wrap in a `relative group` div, render the existing `<pre>` inside, drop a `CopyButton` in the top-right that copies the inner text. This covers all fenced ``` blocks (prompts, code, JSON).
   - **`code`** (inline): leave untouched (no button, just styled).

3. Add a single "copy whole message" `CopyButton` next to the existing timestamp + `MessagePlayButton` row at line 91-98, assistant messages only. Copies `message.text` (raw markdown — best for re-use as a prompt).

No layout shift, no redesign, no new dependencies (lucide `Copy`/`Check` already available).

## Verification

- Trigger `ga4_run_report` from chat with `{propertyId, startDate:"7daysAgo", endDate:"today", dimensions:["pagePath"], metrics:["screenPageViews"]}` → expect rows back, no schema error.
- Render an assistant message with a fenced code block → hover shows copy button; click → clipboard contains the block; check icon flashes.
- Hover the message footer → "copy message" button appears next to the play button.
