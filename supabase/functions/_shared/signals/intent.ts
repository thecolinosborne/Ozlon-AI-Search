// Signal Envelope — A: intent classifier (deterministic verb tables)
import type { Signal } from "./types.ts";

const INTENT_VERBS: Record<string, RegExp[]> = {
  ask: [/\b(what|how|why|when|where|who|which|explain|tell me|show me)\b/i],
  decide: [/\b(should i|should we|which.+better|recommend|pick|choose)\b/i],
  write: [/\b(write|draft|compose|reply|respond|email|message|post)\b/i],
  execute: [/\b(create|add|update|delete|send|schedule|book|move|sync|run|trigger|publish)\b/i],
  fix: [/\b(fix|broken|error|not working|failing|bug|issue|wrong)\b/i],
  plan: [/\b(plan|outline|strategy|roadmap|brainstorm)\b/i],
};

export function classifyIntent(latest: string): Signal[] {
  const matched: Signal[] = [];
  for (const [intent, patterns] of Object.entries(INTENT_VERBS)) {
    if (patterns.some((p) => p.test(latest))) {
      matched.push({
        bucket: "intent",
        priority: "direct",
        key: `intent:${intent}`,
        value: intent,
      });
    }
  }
  if (matched.length === 0) {
    matched.push({
      bucket: "intent",
      priority: "inferred",
      key: "intent:ask",
      value: "ask",
    });
  }
  return matched;
}
