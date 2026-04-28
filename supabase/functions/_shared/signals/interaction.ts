// Signal Envelope — E: interaction style
import type { Signal } from "./types.ts";

export function classifyInteraction(latest: string, recentCount: number): Signal[] {
  const out: Signal[] = [];
  const len = latest.length;

  if (/\b(quick|tldr|short|brief|one.?liner)\b/i.test(latest) || len < 40) {
    out.push({ bucket: "interaction", priority: "direct", key: "interaction:concise", value: "concise" });
  }
  if (/\b(deep dive|explain in detail|walk me through|why|how does)\b/i.test(latest) || len > 280) {
    out.push({ bucket: "interaction", priority: "direct", key: "interaction:deep", value: "deep" });
  }
  if (/\b(should i|recommend|advise|opinion|thoughts)\b/i.test(latest)) {
    out.push({ bucket: "interaction", priority: "direct", key: "interaction:advisory", value: "advisory" });
  }
  if (/\b(just (do|run|send|create|update)|now|go ahead)\b/i.test(latest)) {
    out.push({ bucket: "interaction", priority: "direct", key: "interaction:action-first", value: "action-first" });
  }
  if (out.length === 0) {
    const style = recentCount > 6 ? "concise" : "advisory";
    out.push({ bucket: "interaction", priority: "inferred", key: `interaction:${style}`, value: style });
  }
  return out;
}
