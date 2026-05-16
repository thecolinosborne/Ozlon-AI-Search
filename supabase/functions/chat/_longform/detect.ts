// Long-form intent detection — deterministic, zero-latency.
// Looks at the last user message and returns a LongFormBrief if the request
// matches a long-form pattern (teleprompter, speech, essay, blog, etc.).
// Returns null for normal short-reply chat.

export type LongFormKind =
  | 'teleprompter' | 'speech' | 'voiceover' | 'podcast' | 'sermon' | 'keynote'
  | 'essay' | 'article' | 'blog' | 'newsletter' | 'sales_letter'
  | 'story' | 'chapter' | 'social_thread' | 'long_form';

export interface LongFormBrief {
  kind: LongFormKind;
  target_words: number;
  target_minutes?: number;
  wpm: 150 | 180 | 220;
  structure: 'continuous' | 'scene-paragraphs' | 'chaptered';
  format: 'prose' | 'script' | 'two-column-vo';
  breath_cues: boolean;
  source: 'duration' | 'word-count' | 'page-count' | 'inferred';
  assumed: boolean; // true when length was inferred rather than stated
}

// Keyword → kind map. Order matters — first match wins.
const KIND_PATTERNS: Array<[RegExp, LongFormKind]> = [
  [/\bteleprompter\b/i, 'teleprompter'],
  [/\b(voice ?over|vo script|narration)\b/i, 'voiceover'],
  [/\b(podcast (intro|outro|episode|script))\b/i, 'podcast'],
  [/\bsermon\b/i, 'sermon'],
  [/\b(keynote|key ?note)\b/i, 'keynote'],
  [/\b(speech|talk|address|monologue)\b/i, 'speech'],
  [/\b(sales (letter|page)|vsl|video sales letter)\b/i, 'sales_letter'],
  [/\b(newsletter|email blast)\b/i, 'newsletter'],
  [/\b(blog ?post|blog article)\b/i, 'blog'],
  [/\b(article|op[- ]?ed)\b/i, 'article'],
  [/\bessay\b/i, 'essay'],
  [/\b(short story|chapter|story|novella)\b/i, 'story'],
  [/\b(twitter thread|x thread|long thread)\b/i, 'social_thread'],
  [/\bscript\b/i, 'speech'], // generic "script" → spoken
];

// Spoken vs read kinds, drives wpm and default structure
const SPOKEN: ReadonlySet<LongFormKind> = new Set([
  'teleprompter', 'speech', 'voiceover', 'podcast', 'sermon', 'keynote',
]);

const TWO_COL_VO: ReadonlySet<LongFormKind> = new Set(['voiceover', 'podcast']);

function defaultWpm(kind: LongFormKind): 150 | 180 | 220 {
  if (kind === 'podcast') return 180;
  if (SPOKEN.has(kind)) return 150;
  return 220; // silent reading
}

function defaultStructure(kind: LongFormKind): LongFormBrief['structure'] {
  if (kind === 'story' || kind === 'chapter') return 'chaptered';
  if (SPOKEN.has(kind)) return 'scene-paragraphs';
  return 'continuous';
}

function defaultFormat(kind: LongFormKind): LongFormBrief['format'] {
  if (TWO_COL_VO.has(kind)) return 'two-column-vo';
  if (SPOKEN.has(kind)) return 'script';
  return 'prose';
}

// Default length when none is specified, in words
function defaultWords(kind: LongFormKind): number {
  switch (kind) {
    case 'teleprompter': return 2250;   // ~15 min
    case 'speech':
    case 'keynote':       return 1500;  // ~10 min
    case 'voiceover':     return 450;   // ~3 min
    case 'podcast':       return 5400;  // ~30 min
    case 'sermon':        return 3000;  // ~20 min
    case 'sales_letter':  return 1200;
    case 'blog':
    case 'article':       return 1200;
    case 'essay':         return 1500;
    case 'newsletter':    return 600;
    case 'story':
    case 'chapter':       return 2500;
    case 'social_thread': return 600;
    default:              return 1200;
  }
}

// Parse "15 min" / "1 hour" / "1,200 words" / "3 pages" from text
function extractLength(text: string): { words: number; source: LongFormBrief['source']; minutes?: number } | null {
  const t = text.toLowerCase().replace(/,/g, '');

  // word count: "1200 word", "1,200-word"
  const wordsMatch = t.match(/(\d{2,6})\s*[- ]?\s*word/);
  if (wordsMatch) {
    const w = parseInt(wordsMatch[1], 10);
    if (w >= 200) return { words: w, source: 'word-count' };
  }

  // page count: "3 pages" → ~500 words/page
  const pagesMatch = t.match(/(\d{1,3})\s*[- ]?\s*page/);
  if (pagesMatch) {
    const p = parseInt(pagesMatch[1], 10);
    if (p >= 1) return { words: p * 500, source: 'page-count' };
  }

  // duration: "15 min", "15 minute", "1 hour", "1.5 hours", "1 hr"
  const hourMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  if (hourMatch) {
    const mins = parseFloat(hourMatch[1]) * 60;
    return { words: 0, minutes: mins, source: 'duration' };
  }
  const minMatch = t.match(/(\d{1,3})\s*(?:minutes?|mins?|m)\b/);
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10);
    if (mins >= 1 && mins <= 300) return { words: 0, minutes: mins, source: 'duration' };
  }
  return null;
}

// Detect "write/draft/create me a …" intent verbs (avoids matching incidental mentions)
const INTENT_VERB =
  /\b(write|draft|create|make|generate|prepare|put together|build|compose|outline|rewrite|expand)\b/i;

export function detectLongForm(lastUserMessage: string): LongFormBrief | null {
  if (!lastUserMessage || lastUserMessage.length < 8) return null;
  const text = lastUserMessage;

  // Find kind
  let kind: LongFormKind | null = null;
  for (const [re, k] of KIND_PATTERNS) {
    if (re.test(text)) { kind = k; break; }
  }

  // Fallback: explicit length + intent verb still counts as long_form
  const length = extractLength(text);
  if (!kind) {
    if (length && INTENT_VERB.test(text)) {
      kind = 'long_form';
    } else {
      return null;
    }
  } else {
    // Even for matched kinds, require an intent verb OR a length cue to avoid
    // firing on "I gave a speech yesterday".
    if (!INTENT_VERB.test(text) && !length) return null;
  }

  const wpm = defaultWpm(kind);
  let target_words: number;
  let target_minutes: number | undefined;
  let source: LongFormBrief['source'];
  let assumed = false;

  if (length) {
    if (length.source === 'duration' && length.minutes) {
      target_minutes = length.minutes;
      target_words = Math.round(length.minutes * wpm);
      source = 'duration';
    } else {
      target_words = length.words;
      source = length.source;
      if (SPOKEN.has(kind)) target_minutes = Math.round(target_words / wpm);
    }
  } else {
    target_words = defaultWords(kind);
    if (SPOKEN.has(kind)) target_minutes = Math.round(target_words / wpm);
    source = 'inferred';
    assumed = true;
  }

  // Clamp to sane bounds
  target_words = Math.max(250, Math.min(target_words, 25000));

  return {
    kind,
    target_words,
    target_minutes,
    wpm,
    structure: defaultStructure(kind),
    format: defaultFormat(kind),
    breath_cues: SPOKEN.has(kind),
    source,
    assumed,
  };
}

// Token tier from target word count.
// Rough rule: 1 word ≈ 1.4 tokens, plus ~30% headroom.
export function tokenBudgetFor(words: number): number {
  if (words <= 400) return 16384;
  if (words <= 1500) return 24000;
  if (words <= 4000) return 32000;
  return 48000;
}
