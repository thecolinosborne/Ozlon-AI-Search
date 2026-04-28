// Signal Envelope — C: importance cues
import type { Signal } from "./types.ts";

const CUES: Record<string, RegExp> = {
  urgent: /\b(urgent|asap|right now|immediately|today|emergency)\b/i,
  recurring: /\b(weekly|daily|monthly|every (week|day|month)|recurring)\b/i,
  revenue: /\b(revenue|sales|deal|client|customer|invoice|payment|paid)\b/i,
  personal: /\b(my (preference|style|usual)|i (like|prefer|always|never))\b/i,
  strategic: /\b(strategy|long.term|q[1-4]|roadmap|vision)\b/i,
  blocking: /\b(blocked|waiting on|depends on|can'?t (until|without))\b/i,
};

export function classifyImportance(latest: string): Signal[] {
  const out: Signal[] = [];
  for (const [cue, re] of Object.entries(CUES)) {
    if (re.test(latest)) {
      out.push({
        bucket: "importance",
        priority: cue === "personal" ? "durable" : "direct",
        key: `importance:${cue}`,
        value: cue,
      });
    }
  }
  return out;
}
