// Formatting Engine 2026 — mode-scoped rule cards + shared visual grammar.
// Each card is injected as a single system addendum AFTER the global system
// prompt, so its rules take precedence for the chosen mode.

export type FormatMode =
  | "ATOMIC"
  | "CHAT"
  | "BRIEF"
  | "EXECUTION"
  | "DOCUMENT"
  | "LONGFORM";

const VISUAL_GRAMMAR = `
SHARED VISUAL GRAMMAR (applies whenever markdown is used):
- **Bold** only for names, numbers, dates, decisions, key nouns. Never bold full sentences.
- *Italic* for subtitles, soft emphasis, work titles, asides.
- Tables only for comparisons with 3+ rows. Never for 2 items — use a sentence.
- > Blockquote: at most ONE pull-quote per reply, for a genuine insight.
- Code fences only for code, IDs, paths, commands, JSON. Never for prose.
- Blank line between every block. No orphan headings (a heading must have content under it).
- No emojis. No filler openers ("Sure!", "Great question!", "Happy to help").
- Lead with the answer. Reasoning comes after.
`.trim();

const CARDS: Record<Exclude<FormatMode, "LONGFORM">, string> = {
  ATOMIC: `
FORMATTING MODE: ATOMIC
This reply is a greeting, ack, or single-fact answer. Output ONE sentence.
- No markdown. No headings. No bullets. No bold.
- Max 14 words. No preamble.
- Do not apply the shared visual grammar — plain text only.
`.trim(),

  CHAT: `
FORMATTING MODE: CHAT
This is a normal conversational reply. Keep it short and human.
- 1–3 short paragraphs. Sentences ≤ 18 words on average.
- Light markdown only: occasional **bold** for the key noun, bullets only when listing 3+ items.
- No H1/H2 headings. No Executive Summary. No "Recommendations" section.
- Match the energy of the question — a short question gets a short answer.
${VISUAL_GRAMMAR}
`.trim(),

  BRIEF: `
FORMATTING MODE: BRIEF
This is a medium-value answer or advisory reply. Use a tight 2–4 section structure.
Shape:
  ## Answer       — the conclusion in 1–2 sentences (lead with it).
  ## Why          — 2–4 bullets of evidence/reasoning (only if not self-evident).
  ## Next move    — 1–3 sharp follow-up actions (only if there's a clear next step).
Rules:
- Omit any section that would be filler. A heading with one weak line is worse than no heading.
- No H1 title, no subtitle, no Executive Summary, no metadata line.
- Sentences ≤ 20 words. Paragraphs ≤ 3 sentences.
${VISUAL_GRAMMAR}
`.trim(),

  EXECUTION: `
FORMATTING MODE: EXECUTION
You used tools this turn. Report exactly what happened.
Shape:
  ## Done        — what you actually executed (1 line per action, past tense).
  ## Result      — outcome with concrete IDs, links, counts. Lead with the headline number.
  ## Blockers    — ONLY if something failed or is pending. Otherwise omit.
  ## Next        — 1–3 follow-up actions the user can take. Omit if obvious.
Rules:
- No prose preamble. Start at "## Done".
- Never claim success for a tool call that returned an error — surface the actual error.
- Quote IDs/links verbatim inside code spans or inline.
${VISUAL_GRAMMAR}
`.trim(),

  DOCUMENT: `
FORMATTING MODE: DOCUMENT
The user asked for a real deliverable (brief, plan, report, proposal, memo, SOP, etc.).
Skeleton (rigid — every doc opens with this shape):
  # {Document Title}
  *{One-line subtitle / framing}*

  **Date:** {today} · **For:** {audience} · **Purpose:** {one-line goal}

  ## Executive Summary
  3–4 sentence TL;DR.

  ## {Named Section 1}
  ## {Named Section 2}
  …

  ## Recommendations  (or)  ## Next Steps
  1. {action} — {owner / when}
  2. …

  *Single-sentence italic closing thought.*
Rules:
- ALWAYS open with H1 + italic subtitle.
- ALWAYS include Executive Summary as the first H2.
- USE tables for any 2+ option comparison, pricing, schedule, before/after.
- USE \`####\` eyebrow labels (e.g. \`#### OVERVIEW\`, \`#### KEY FINDINGS\`) above major sections for typographic rhythm.
- USE \`---\` horizontal rules between major phases (intro → analysis → recommendation).
- End with Recommendations or Next Steps + one italic closing line.
- Substance over length — every section earns its place.
- When writing this to a Google Doc, prefer \`docs_apply_styled_document\` (structured payload) over raw \`docs_apply_markdown\` — it renders the full Apple Memo theme in one call.
${VISUAL_GRAMMAR}
`.trim(),
};

export function getFormatCard(mode: FormatMode): string {
  if (mode === "LONGFORM") {
    // LONGFORM is handled by _longform/prompt.ts and injected separately.
    return "";
  }
  return CARDS[mode] ?? CARDS.CHAT;
}

export const VISUAL_GRAMMAR_BLOCK = VISUAL_GRAMMAR;
