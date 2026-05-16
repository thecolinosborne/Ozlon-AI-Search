// Formatting Engine 2026 — deterministic mode router.
// Classifies each turn into exactly one FormatMode BEFORE the model sees the
// prompt. Inputs are cheap heuristics (regex + flags) — no LLM call.

import type { FormatMode } from "./cards.ts";

export interface RouteInput {
  userText: string;            // last user message content
  intent?: string | null;      // SignalEnvelope intent bucket if available
  isLongForm?: boolean;        // true when _longform/detect.ts fires
  willUseTools?: boolean;      // server-detected action intent
}

export interface RouteResult {
  mode: FormatMode;
  reason: string;              // short tag for telemetry
}

const DOCUMENT_VERBS =
  /\b(write|draft|create|generate|put together|give me|prepare|build me|compose|produce)\b/i;
const DOCUMENT_NOUNS =
  /\b(brief|plan|report|proposal|summary|doc|document|write-?up|outline|recap|agenda|sop|memo|analysis|strategy|playbook|one-?pager|meeting notes|spec|roadmap|breakdown|deck)\b/i;

const ATOMIC_PATTERNS = [
  /^\s*(hi|hello|hey|yo|sup|gm|gn|thanks|thank you|thx|ty|ok|okay|cool|got it|nice|great|perfect|sweet|👍|sure|yep|yes|no|nope|cheers)\b[!.\s]*$/i,
  /^\s*(who|what|when|where) (is|are|was|were) [a-z ]{1,30}\??\s*$/i, // very short factual
];

const SHORT_WORD_LIMIT = 6;

export function routeFormat(input: RouteInput): RouteResult {
  const text = (input.userText || "").trim();

  // 1. LONGFORM wins if the detector already fired.
  if (input.isLongForm) {
    return { mode: "LONGFORM", reason: "longform-detector" };
  }

  // 2. EXECUTION wins if tools will run this turn.
  if (input.willUseTools) {
    return { mode: "EXECUTION", reason: "tool-plan" };
  }

  // 3. DOCUMENT: explicit "write me a {doc-noun}" framing.
  if (DOCUMENT_VERBS.test(text) && DOCUMENT_NOUNS.test(text)) {
    return { mode: "DOCUMENT", reason: "doc-verb+noun" };
  }

  // 4. ATOMIC: greetings, acks, ultra-short messages.
  if (ATOMIC_PATTERNS.some((re) => re.test(text))) {
    return { mode: "ATOMIC", reason: "atomic-pattern" };
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 0 && words.length <= SHORT_WORD_LIMIT && !/[?]/.test(text)) {
    return { mode: "ATOMIC", reason: "short-non-question" };
  }

  // 5. BRIEF: questions, advisory intents, or medium-length requests.
  const isQuestion = /\?/.test(text) || /^(how|why|should|can|could|would|what|when|where|which)\b/i.test(text);
  const advisoryIntent = input.intent === "decide" || input.intent === "advise";
  if (isQuestion || advisoryIntent || words.length > 30) {
    return { mode: "BRIEF", reason: isQuestion ? "question" : advisoryIntent ? "advisory" : "long-input" };
  }

  // 6. CHAT: default.
  return { mode: "CHAT", reason: "default" };
}
