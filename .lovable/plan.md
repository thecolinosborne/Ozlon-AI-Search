

## Build: Document Formatting Upgrade

Surgical, additive. Three coordinated changes — typography becomes real, AI knows when to write documents vs chat, document artifacts get proper chrome. Affects every markdown surface in the app.

## Changes

### 1. Tailwind Typography (root cause fix)
- Install `@tailwindcss/typography`
- Register plugin in `tailwind.config.ts`
- Add custom `typography` theme tuned to Vision Pro aesthetic:
  - H1 1.5rem / semibold / tight tracking
  - H2 1.25rem / semibold / mt-6 mb-3 with subtle bottom border
  - H3 1.05rem / medium
  - Body line-height 1.7, color `hsl(var(--foreground)/0.9)`
  - Lists with refined bullets, proper indentation
  - Blockquotes: left border `hsl(var(--primary)/0.4)`, italic, muted
  - `code` inline: `bg-muted/60 px-1.5 py-0.5 rounded text-[0.85em]`
  - Tables: clean borders, header row `bg-muted/30`, generous cell padding
  - Strong/em with proper weight contrast
  - HR: thin divider `border-border/40`

This single change makes every existing `prose` class start working — chat bubbles, artifacts, email drafts all gain hierarchy instantly.

### 2. Two-Mode Formatting Contract (chat edge function)
Edit the system prompt in `supabase/functions/chat/index.ts`. Replace the current "basic markdown only / no tables" rules with:

**Conversational Mode (default)** — short, scannable, light markdown. Current behavior preserved.

**Document Mode** — triggered when user requests: brief, plan, report, proposal, summary, doc, write-up, outline, recap, agenda, SOP, memo, analysis, strategy, playbook, one-pager. Output structure:
- `# Document Title` + italic one-line subtitle
- Optional metadata block (Date · Author · Audience · Purpose) when relevant
- `## Executive Summary` — 3-4 sentence TL;DR first
- Numbered or named `## Sections` with H3 sub-sections where useful
- Tables for any comparison (lift the no-tables ban)
- `>` pull quotes for key insights
- `## Recommendations` or `## Next Steps` to close
- Templates inline for: Brief, Plan, Report, Meeting Notes, Email, SOP, Proposal, Strategy Memo

Add explicit selection rule: *"If the user says 'write/draft/create/generate me a [document type]', switch to Document Mode. Otherwise stay conversational."*

~50 lines of prompt added. No behavior change for normal chat — only structured output when explicitly asked.

### 3. Document Chrome on ArtifactRenderer
Edit `src/components/threads/ArtifactRenderer.tsx`. For artifact types `markdown | plan | decision | action_result`:
- Wrap body in a paper-like card: `bg-card border border-border/40 shadow-sm rounded-xl p-8 sm:p-10`
- Render `artifact.title` as a real H1 at top with thin divider beneath (`border-b border-border/30 pb-4 mb-6`)
- Optional metadata strip below title showing version, created date, type badge
- Body uses `prose prose-sm sm:prose-base max-w-none` — now functional after step 1
- `remark-gfm` already loaded → tables/strikethrough/task lists work automatically
- Other artifact types (email_draft, image, file, checklist, doc_link) unchanged

### 4. Chat bubble polish (zero-edit win)
`MessageBubble.tsx` and `ChatMessageList.tsx` already use `prose prose-sm prose-neutral dark:prose-invert` — once typography plugin loads, they automatically gain proper heading hierarchy. No edit needed.

## Files touched

- `package.json` — add `@tailwindcss/typography`
- `tailwind.config.ts` — register plugin + custom typography theme
- `supabase/functions/chat/index.ts` — replace formatting rules block with two-mode contract + templates
- `src/components/threads/ArtifactRenderer.tsx` — document chrome for doc-type artifacts

**Untouched:** `MessageBubble.tsx`, `ChatMessageList.tsx`, message types, backend routing, edge function logic. Auto-improves once plugin lands.

## Verification

1. Ask *"What time is it?"* → short conversational reply, no over-formatting
2. Ask *"Write me a marketing brief for launching X"* → returns titled document with Executive Summary, sections, Recommendations
3. Past chat replies with `##` headings now show clear visual hierarchy (size + weight + spacing)
4. AI uses tables when comparing options instead of bullet lists
5. Open a markdown artifact → renders as paper-like document with title header, divider, generous padding
6. Click "Save to Google Doc" → exported doc mirrors the visual structure

## Outcome

Every produced document looks intentional and intelligent: title, hierarchy, tables, pull quotes, recommendations. Chat replies stay fast and conversational. The AI knows the difference. Zero regressions to existing surfaces — the typography plugin is purely additive.

