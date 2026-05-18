## Goal

Stop the AI from producing flat, ugly Google Docs. Land every doc on a **Minimal Apple Memo** look: one sans family, hierarchy from weight + size + whitespace, no color, real title block, page setup, and full markdown support (tables, blockquotes, horizontal rules, code blocks, nested lists, clickable links).

Two surfaces:
1. **apply_markdown** — rebuilt to handle the full markdown set and auto-theme the doc.
2. **apply_styled_document** — new tool that takes a structured payload (title, subtitle, metadata, sections, tables, recommendations) and renders the full themed memo in one batchUpdate.

All work is in `supabase/functions/google-docs/index.ts` and the manifest at `supabase/functions/_shared/integrations/google-docs.ts`. No DB, no UI, no new secrets.

---

## Aesthetic spec — "Apple Memo"

| Element | Rule |
|---|---|
| Body font | Inter (fallback Helvetica Neue, then Arial) |
| Body size / leading | 11pt, line spacing 1.35, 8pt space below paragraph |
| Title (H1) | 28pt, weight 700, 24pt space below, no color |
| Subtitle | 13pt italic, color #6B6B6B, 4pt space below |
| Metadata row | 10pt, color #6B6B6B, 16pt space below |
| H2 | 18pt, weight 600, 20pt space above, 6pt space below |
| Eyebrow (`#### LABEL`) | 9pt, weight 600, letter-spaced caps via UPPERCASE text, color #8A8A8A, 4pt below |
| H3 | 13pt, weight 600, 12pt above, 4pt below |
| Body | inherits |
| Blockquote | 11pt italic, left indent 18pt, 1pt left border via empty bordered paragraph |
| Code span | Roboto Mono 10pt, bg #F2F2F2 |
| Code block | Roboto Mono 10pt, bg #F7F7F7, left indent 12pt |
| Horizontal rule (`---`) | Empty paragraph with bottom border, 12pt above + below |
| Table | Header row bold + bg #F5F5F5, 0.5pt border #E5E5E5, 6pt cell padding |
| Bullets | DISC → CIRCLE → SQUARE, 18pt indent per level |
| Numbered | DECIMAL → ALPHA → ROMAN |
| Page setup | A4-ish: top/bottom 72pt, left/right 90pt margins |
| Closing line | Auto-detect last italic line → 10pt color #8A8A8A |

No color accents beyond grays. Hierarchy is type + space.

---

## Work breakdown

### 1. New theme module (in same file, top of file)
- `APPLE_MEMO_THEME` constant — all numbers above in one object so it's easy to tweak.
- `applyDocumentTheme(token, documentId, endIndex)` — sets page margins (`updateDocumentStyle`), applies base font + leading across the whole body, retunes the named styles (HEADING_1..3, NORMAL_TEXT) via `updateParagraphStyle` so future inserts inherit them.

### 2. Rebuilt markdown renderer (`buildMarkdownRequests` v2)
New token types supported:
- `####` eyebrow → uppercase + small caps style
- `>` blockquote → italic + left indent
- ` ``` ` fenced code block → mono, gray bg, indent
- `---` / `***` → bordered empty paragraph (horizontal rule)
- `| a | b |` GFM tables → real Docs `insertTable` + per-cell text + header styling
- `[label](url)` → text with `link` style
- Nested bullets (indent-aware, 2/4 spaces or tab)
- Inline `~~strike~~` → strikethrough
- Preserve existing `**bold**`, `*italic*`, `` `code` ``

Renderer returns `{ requests, endIndex }` like today but emits paragraph styles per the theme (not just `namedStyleType`). Implementation note: tables must be inserted with `insertTable` first, then cell content via cell-anchored `insertText` — we walk the freshly-fetched doc to get cell indices, OR insert tables one-at-a-time at end-of-body, refetch, and continue (simpler, more reliable).

### 3. Retheme `format_as_report`
- Becomes a thin wrapper: calls `applyDocumentTheme` + promotes the first non-empty paragraph to title + (if a second non-empty paragraph exists and is short/italic) styles it as subtitle.
- Drops the current Arial-11 / line-spacing 115 defaults in favor of the new theme.

### 4. New action: `apply_styled_document`
Input schema:
```ts
{
  documentId: string,
  replaceAll?: boolean,        // default true
  title: string,
  subtitle?: string,
  meta?: { date?: string, for?: string, purpose?: string },
  executiveSummary?: string,   // rendered as first section
  sections: Array<{
    eyebrow?: string,          // small caps label above heading
    heading: string,           // H2
    body?: string,             // markdown — uses renderer v2
    table?: { headers: string[], rows: string[][] },
    callout?: string,          // blockquote
  }>,
  recommendations?: string[],  // numbered list at end
  closing?: string,            // italic gray closing line
}
```
Flow: wipe doc → `applyDocumentTheme` → insert title block → insert metadata row → for each section: eyebrow + H2 + body + optional table + optional callout → recommendations → closing → optional horizontal rules between phases.

### 5. Manifest update (`_shared/integrations/google-docs.ts`)
Add one tool entry:
- `docs_apply_styled_document` → action `apply_styled_document`, full JSON schema above, description that nudges the AI to use this for any real deliverable (brief, report, memo, SOP) while keeping `docs_apply_markdown` for ad-hoc writes.

Tighten description on `docs_apply_markdown` to mention the new supported features (tables, quotes, rules, code blocks, links) so the AI uses them.

### 6. Prompt nudge (one-line edit)
In `supabase/functions/chat/_format/cards.ts` DOCUMENT card, add a single bullet under the existing skeleton: *"When writing to Google Docs, prefer `docs_apply_styled_document` (structured) over raw `docs_apply_markdown`."* — so existing skills that render to Docs route through the new tool.

### 7. Verification
- Deploy `google-docs` + `chat`.
- Curl `apply_markdown` with a sample containing every token (heading, quote, table, code block, rule, link, nested list).
- Curl `apply_styled_document` with a realistic brief payload.
- Open both docs in the user's Drive and visually confirm.

---

## Files touched

- `supabase/functions/google-docs/index.ts` — theme module, renderer v2, retuned `format_as_report`, new `apply_styled_document` action.
- `supabase/functions/_shared/integrations/google-docs.ts` — new manifest entry + tightened descriptions.
- `supabase/functions/chat/_format/cards.ts` — one-line nudge in DOCUMENT card.

## Out of scope

- No new edge functions, no migrations, no UI changes.
- Not touching how skills generate markdown — they keep emitting markdown; the renderer just gets much better.
- No image insertion (Docs API requires hosted URLs — separate ticket if you want it).
- No multi-column layouts or charts.

## Risk / rollback

Pure additive on the manifest side. The renderer rewrite changes output of `apply_markdown` — if a regression appears, revert `google-docs/index.ts` only; manifest and prompt edits are harmless on their own.