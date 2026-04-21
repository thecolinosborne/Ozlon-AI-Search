

## Confirm: Gemini Key + Add Google Docs Styling Tools + Model Visibility

### On your Gemini API key

Yes — you have `GEMINI_API_KEY` set, **and** you have `LOVABLE_API_KEY` (the Lovable AI Gateway, which routes to Gemini 2.5/3 Pro/Flash, GPT-5, etc. without per-provider keys). The chat backend already uses both. Gemini access is **not** the blocker.

The actual gap is what the AI *does* with that access — it doesn't know how to apply rich Google Docs styling, and it doesn't tell you which model handled your turn. Both are fixable now.

### What we're building

**1. Four new high-level Google Docs styling tools** (`supabase/functions/google-docs/index.ts`)

Wraps the raw Docs API into actions the AI can actually use:

- `apply_markdown` — `{ documentId, markdown, replaceAll? }`. Parses markdown server-side and emits one `batchUpdate` with `insertText` + `updateTextStyle` (bold/italic/code) + `updateParagraphStyle` (HEADING_1/2/3, NORMAL_TEXT) + `createParagraphBullets`. The killer tool: AI writes markdown → fully styled doc.
- `format_as_report` — `{ documentId }`. Reads the doc, detects title/headings, applies a clean theme (Inter/Arial, 24/16/11pt, line spacing 1.15). One-shot "make this look professional."
- `style_range` — `{ documentId, startIndex, endIndex, bold?, italic?, fontSize?, foregroundColor?, link? }`. Surgical span styling.
- `clear_formatting` — strips styling on a range or whole doc.

**2. Wire the 4 tools into the chat function** (`supabase/functions/chat/index.ts`)

Add tool schemas, routing entries, and label/domain map entries (matching the existing `docs_*` pattern). Add a `DOCUMENT STYLING PROTOCOL` block to the system prompt:

> When the user asks you to create, update, restyle, or "make a doc look nice":
> 1. Creating with content → `create_google_doc` (title only) → `docs_apply_markdown` with the body.
> 2. Restyling existing doc → `docs_get_document` → `docs_apply_markdown` with `replaceAll: true`, OR `docs_format_as_report`.
> 3. Surgical edits → `docs_style_range`.
> 4. Never say "I can't edit/style this doc" — you have full Docs read/write. If a call fails, report the actual error.

**3. Model attribution in the reply** (`src/components/chat/ChatMessageList.tsx`)

Add a small muted footer under each assistant bubble: *"via google/gemini-3-flash-preview · 1.2s"*. Data already arrives via the `provider_used` SSE event captured in `useChatStream.ts` — just needs rendering. Click to expand the full routing trace (already on the message as `orchestration`).

### Files touched

- `supabase/functions/google-docs/index.ts` — add 4 actions (~150 lines additive, existing actions untouched).
- `supabase/functions/chat/index.ts` — 4 tool schemas + routing + protocol prompt (~50 lines additive).
- `src/components/chat/ChatMessageList.tsx` — model/latency footer under assistant bubble (~15 lines).

### Out of scope

- No changes to Gmail, Calendar, Drive, Sheets, Slides, GSC, GA4 — already fully wired.
- No new connectors or API keys (Gemini already routed via gateway).
- No changes to gauntlet routing, voice, onboarding, or auth.

### Verification

1. *"Create a Google Doc titled 'Q2 Plan' with a bolded title, two H2 sections with bullets, and a 3-row table"* → opens fully styled.
2. *"Open my last doc and reformat it as a clean report"* → `format_as_report` runs, doc visibly restyled.
3. Assistant bubble shows *"via google/gemini-3-flash-preview · 0.8s"* footer.

