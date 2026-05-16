// Builds the long-form system-prompt addendum from a LongFormBrief.
// Inserted as an extra system message right before the user's last turn so it
// overrides the global brevity / document-mode rules just for this reply.

import type { LongFormBrief } from "./detect.ts";

const KIND_LABEL: Record<LongFormBrief["kind"], string> = {
  teleprompter: "teleprompter script",
  speech: "speech",
  voiceover: "voiceover script",
  podcast: "podcast script",
  sermon: "sermon",
  keynote: "keynote",
  essay: "essay",
  article: "article",
  blog: "blog post",
  newsletter: "newsletter",
  sales_letter: "sales letter",
  story: "short story",
  chapter: "chapter",
  social_thread: "long-form social thread",
  long_form: "long-form piece",
};

export function buildLongFormPrompt(brief: LongFormBrief): string {
  const label = KIND_LABEL[brief.kind];
  const min = Math.round(brief.target_words * 0.9);
  const max = Math.round(brief.target_words * 1.1);
  const minLine = brief.target_minutes ? ` (~${brief.target_minutes} min @ ${brief.wpm} wpm)` : "";
  const footer = brief.target_minutes
    ? `*~${brief.target_words.toLocaleString()} words · ~${brief.target_minutes} min @ ${brief.wpm} wpm*`
    : `*~${brief.target_words.toLocaleString()} words · ~${Math.round(brief.target_words / 220)} min read*`;

  const isSpoken = brief.format !== "prose";
  const allowBreathCues = brief.breath_cues;
  const isTwoColumn = brief.format === "two-column-vo";
  const isChaptered = brief.structure === "chaptered";

  const structureRule = (() => {
    if (isTwoColumn) {
      return `Two-column format. Each line is either \`VO:\` (spoken) or \`SFX:\`/\`MUSIC:\` (cues). No prose chrome.`;
    }
    if (isChaptered) {
      return `Use scene breaks (\`***\` on its own line) between scenes. Format dialogue with em-dashes or quoted lines. No H1, no H2.`;
    }
    if (isSpoken) {
      return `Pure flowing prose broken into scene-paragraphs of 3–6 sentences, separated by a blank line so the teleprompter scrolls cleanly. No headings, no bullets, no tables, no titles. Just the words to be spoken.`;
    }
    return `Continuous prose. Paragraphs of 3–7 sentences. H2 headings ONLY if the piece has genuinely distinct sections (most don't). No bullets unless the user specifically asked for a list. No Executive Summary, no Recommendations block, no metadata header.`;
  })();

  const cadenceRule = isSpoken
    ? `Write for the ear, not the eye. Use contractions. Vary sentence length — mix short punches with longer rolling lines. Read it aloud in your head; if a sentence trips, rewrite it. Avoid stacked subordinate clauses.`
    : `Write with reading rhythm. Vary sentence length. Contractions on. Active voice. No corporate filler.`;

  const cuesRule = allowBreathCues
    ? `You may use \`[pause]\` and \`[beat]\` inline when they genuinely serve delivery — never as decoration. Never use stage directions like \`(smiling)\`.`
    : `No stage directions, no bracketed cues.`;

  const assumptionLine = brief.assumed
    ? `\nBecause the user didn't specify length, open the response with this single italic line on its own (no preamble before it):\n  \`*Assuming a ${brief.target_words.toLocaleString()}-word ${label}${minLine}. Tell me if you want it longer, shorter, or in a different voice.*\`\nThen leave a blank line and begin the piece.\n`
    : "";

  return `
===========================================================
LONG-FORM MODE — THIS REPLY ONLY
===========================================================
The user is asking for a ${label}. This is a long-form deliverable, NOT a chat answer.

LENGTH CONTRACT (NON-NEGOTIABLE)
- Target: **${brief.target_words.toLocaleString()} words**${minLine}.
- Acceptable range: ${min.toLocaleString()}–${max.toLocaleString()} words.
- Under-delivering is a failure. If you're approaching the limit and finishing short, expand the middle — never pad the ending.
- Before writing, plan silently how many words each beat will carry so the totals add up to the target.
- After writing, estimate your word count. If under 90% of target, keep writing more substance until you're in range. Do not stop early.

STRUCTURE
${structureRule}

VOICE & CADENCE
${cadenceRule}

CUES
${cuesRule}

GLOBAL RULE OVERRIDES (for this reply only)
- The CONVERSATIONAL brevity rules ("≤3-sentence paragraphs", "match the energy of the question", "14-word sentences") DO NOT APPLY here.
- The DOCUMENT MODE skeleton (Title, Executive Summary, Recommendations) DO NOT APPLY here. This is a deliverable to be read or spoken, not a memo.
- No "Sure!", no "Here's…", no "I hope this helps", no closing meta-commentary. Just the piece.
- No AI-tells: avoid "In conclusion," "Let's dive in," "It's important to note," "In today's fast-paced world," "navigate the complexities of."
- No headings unless the structure rule above explicitly allows them.
- No bullet lists unless the user asked for a list.

ENDING
- End on a real closing line — a landing, a turn, a callback to the opening. Never end mid-thought.
- After the final line of the piece, leave one blank line, then close with this single italic footer on its own line:
  ${footer}
${assumptionLine}
Begin the piece now.
===========================================================
`.trim();
}
