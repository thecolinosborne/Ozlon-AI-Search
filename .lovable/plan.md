

## Document Formatting v2 — Editorial Polish

The structure landed. Now the *typography* needs to feel editorial, not academic. Three coordinated upgrades, all surgical.

## What changes

### 1. Real typographic hierarchy (tailwind.config.ts)

Right now H1/H2/H3 step down too gently and use the same Inter weight throughout. Upgrade to a magazine-style scale:

- **H1**: 2.25rem (36px), weight 700, tracking-tight, line-height 1.15 — commands the page
- **H2**: 1.5rem (24px), weight 600, tracking-tight, mt-10 mb-4, thin bottom border `border-border/30`, pb-2
- **H3**: 1.15rem (18.5px), weight 600, mt-7 mb-2, color `foreground` (not muted)
- **H4**: 0.95rem, weight 600, **uppercase**, tracking-wider, color `muted-foreground` — acts as eyebrow label
- **Body**: line-height 1.75, max-width measure for readability
- **First paragraph after H1** (`.prose > h1 + p`): slightly larger (1.05rem), weight 400, color `foreground/80`, italic — functions as lede/subtitle automatically
- **Drop cap option**: `.prose .lede::first-letter` — large initial cap for opening paragraph in long-form documents
- **Blockquote**: serif font (`font-family: ui-serif, Georgia`), 1.1rem, italic, no quote marks, left border `primary/50` 4px, generous padding
- **Strong**: weight 700 (currently 600), color `foreground` for stronger contrast
- **Em**: italic + slight color shift `foreground/95`
- **Lists**: bullets become small filled circles (`•` at 0.6em, primary/60 color), numbered lists use tabular-nums, weight 600 markers
- **Tables**: header row `bg-muted/40`, weight 600 uppercase tracking-wide labels, zebra rows `even:bg-muted/10`
- **HR**: gradient fade `via-border/60` instead of flat line
- **Code**: monospace with `bg-muted/50`, slight border, weight 500

Add a serif font import (`Lora` or `Source Serif 4`) for blockquotes and an optional document-title variant — gives instant editorial feel without changing body font.

### 2. Document-mode prompt: visual polish rules (chat/index.ts)

Add a "Visual Craft" subsection to the existing Document Mode contract:

- Use **bold** for key terms, names, numbers — not whole sentences
- Use *italics* for emphasis, foreign terms, titles of works, subtle asides
- Use H4 (`####`) as **eyebrow labels** above sections (e.g. `#### OVERVIEW`, `#### KEY FINDINGS`) — they auto-render uppercase
- Use blockquotes (`>`) sparingly for genuine pull-quotes or notable insights — never for plain text
- Use horizontal rules (`---`) to separate major document phases
- **Approved professional emoji set** (use sparingly, max ~5 per document, only as section accents):
  - ◆ ▸ ▪ — neutral structural markers
  - ✓ ✗ — verification/checklist results
  - → ⇢ — flow/next steps
  - ★ — highlighted recommendation
  - ⚠ — risk/caution callout
  - **Banned**: 😀 🎉 🚀 💡 🔥 and all colored/cartoon emoji — they kill professionalism
- Tables for any 2+ option comparison; never bullet-list comparisons
- Numbered sections for sequential plans, named sections for thematic docs
- End every document with a single-sentence italic *closing thought* below recommendations

Add 1 worked example in the prompt (a mini "Strategy Memo") so the model has a visual reference.

### 3. ArtifactRenderer chrome refinement (ArtifactRenderer.tsx)

Small but high-impact:

- Increase document padding to `p-10 sm:p-14` (more whitespace = more premium)
- Title block: H1 already styled by prose; add `font-display` if serif loaded
- Metadata strip: replace flat row with monospace small caps `font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground` — looks like a real document header
- Add subtle paper texture: `bg-gradient-to-b from-card to-card/95` + inset ring `ring-1 ring-border/20`
- Add a thin **accent bar** at the top of the card (4px, `bg-gradient-to-r from-primary/40 via-primary/20 to-transparent`) — instant editorial signal
- First-paragraph-after-title gets `lede` class for automatic drop-cap eligibility (only triggers on paragraphs ≥ 200 chars to avoid weird short-doc behavior)
- Print-friendly: add `print:bg-white print:text-black` so "Save to PDF" via browser produces clean output

### Files touched

- `tailwind.config.ts` — expand typography theme (h1-h4 scale, lede, blockquote serif, list markers, table polish)
- `index.html` — add Lora or Source Serif 4 font preconnect + import
- `supabase/functions/chat/index.ts` — append "Visual Craft" rules + approved emoji whitelist + worked example to Document Mode block
- `src/components/threads/ArtifactRenderer.tsx` — accent bar, monospace metadata, larger padding, lede class on first paragraph

**Untouched:** chat composer, message bubbles (auto-improve via prose), routing, edge function logic, conversational mode behavior.

## Verification

1. Ask *"Draft a strategy memo for launching a paid tier"* → returns memo with H1 title, italic subtitle/lede paragraph, eyebrow H4 sections, one pull quote in serif italic, comparison table, ★ recommendation, italic closing line
2. Headings now have **strong** size jumps (36 → 24 → 18.5) you can see at a glance
3. Eyebrow labels render UPPERCASE in muted color above sections
4. Blockquotes render in serif italic — feels like a real quote
5. Tables have uppercase header labels, zebra striping
6. Conversational mode unchanged — short messages stay short
7. No cartoon emoji appear, only ◆ → ★ ✓ ⚠ when contextually warranted
8. Print/Save-to-PDF produces clean black-on-white output

## Outcome

Documents stop looking like rendered markdown and start looking like something a senior strategist actually wrote — clear hierarchy, editorial typography, restrained tasteful accents, professional emoji vocabulary only where it adds meaning.

