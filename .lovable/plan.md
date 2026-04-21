

## Fix Ugly AI Output: Enforce Markdown Formatting

### Root cause

Two problems compounding:

1. **Backend isn't asking for markdown.** The chat system prompt (`supabase/functions/chat/index.ts`) never tells the model to format responses with headings, bold, or bullets. The model defaults to wall-of-text prose.
2. **Frontend renders markdown inconsistently.** `ChatMessageList.tsx` (the component actually used in the unified chat) renders assistant messages in `bg-neutral-100` with `prose-sm prose-neutral` — but **prose styles don't apply to `<strong>`, `<h2>`, lists, etc. with enough visual weight against that background**, and the prose plugin's defaults for headings/spacing are muted. Even when the model *does* emit markdown today, it looks flat.

`MessageBubble.tsx` (a sibling component) has better prose styling but isn't the one rendering in the live chat surface.

### Fix

**1. Backend — teach the model to format (`supabase/functions/chat/index.ts`)**

Add a `RESPONSE FORMATTING` block near the top of the system prompt:

> Always format responses in clean Markdown.
> - Use `##` headings for sections when the answer has 2+ distinct parts.
> - Use `**bold**` for key terms, names, numbers, and decisions.
> - Use bullet lists (`-`) for any enumeration of 2+ items — never inline comma lists.
> - Use numbered lists for sequential steps.
> - Use `>` blockquotes for quoted/cited content.
> - Use fenced code blocks with language tags for code, commands, IDs, or paths.
> - Use tables for comparisons of 3+ rows.
> - Keep paragraphs short (≤3 sentences). Add blank lines between blocks.
> - Lead with the answer, then supporting detail. No filler preambles.

This sits alongside existing House Rules and is honored on every turn.

**2. Frontend — make markdown look premium (`src/components/chat/ChatMessageList.tsx`)**

Upgrade the assistant bubble's prose classes so headings, bold, lists, code, and tables render with visible hierarchy:

- Swap `bg-neutral-100 text-neutral-800` → `bg-card/60 backdrop-blur-md border border-border/30 text-foreground` (matches the app's Vision Pro aesthetic and gives prose enough contrast).
- Expand prose modifiers: stronger heading sizes/weights, tighter list spacing, styled `code`/`pre` (rounded, subtle bg), styled tables (borders, header bg), styled blockquotes (left border + muted bg), bold gets `font-semibold text-foreground`.
- Keep the existing `linkifyPlainUrls` + `remarkGfm` (already correct for tables, task lists, strikethrough).

Concretely, the `prose` className becomes:

```
prose prose-sm dark:prose-invert max-w-none break-words
prose-headings:font-semibold prose-headings:tracking-tight
prose-h1:text-lg prose-h2:text-base prose-h3:text-sm
prose-h2:mt-4 prose-h2:mb-2 prose-h3:mt-3 prose-h3:mb-1.5
prose-p:my-2 prose-p:leading-relaxed
prose-strong:text-foreground prose-strong:font-semibold
prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:marker:text-muted-foreground
prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:bg-muted prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none
prose-pre:bg-muted prose-pre:border prose-pre:border-border/40 prose-pre:rounded-lg
prose-blockquote:border-l-2 prose-blockquote:border-primary/40 prose-blockquote:bg-muted/30 prose-blockquote:py-1 prose-blockquote:px-3 prose-blockquote:not-italic
prose-table:text-xs prose-th:bg-muted/50 prose-th:font-semibold prose-td:border prose-td:border-border/30 prose-th:border prose-th:border-border/30
prose-a:text-primary prose-a:no-underline hover:prose-a:underline
prose-hr:border-border/40
```

User bubble stays as-is (plain text, primary color).

### Files touched

- `supabase/functions/chat/index.ts` — add `RESPONSE FORMATTING` block to system prompt.
- `src/components/chat/ChatMessageList.tsx` — upgrade assistant bubble background + prose classes.

### Out of scope

- No changes to `MessageBubble.tsx` (legacy/unused in the unified chat surface today — leaving alone per additive policy).
- No changes to streaming, tool calls, voice, or any other behavior.
- No schema or edge function logic changes beyond the prompt string.

### Verification after implementation

Send a multi-part question (e.g., *"compare gpt-5 vs gemini-2.5-pro for our use case"*) — response should render with `##` sections, **bold** model names, bulleted pros/cons, and a styled comparison table instead of a paragraph blob.

