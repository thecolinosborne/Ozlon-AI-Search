// Signal Envelope — consumer renderers
// Each consumer picks one renderer. The full envelope is never serialized whole.

import type { SignalEnvelope } from "./types.ts";

interface ChatRenderOptions {
  topN?: number;
}

/**
 * Renders a compact 5–8 line block for chat system prompts.
 * Only top-N highest-priority signals from each bucket.
 */
export function renderForChatPrompt(env: SignalEnvelope, opts: ChatRenderOptions = {}): string {
  const topN = opts.topN ?? 3;
  const lines: string[] = [];
  lines.push("PRIORITY CONTEXT (signal envelope):");

  const intent = env.intent.slice(0, topN).map((s) => s.value).join(", ");
  if (intent) lines.push(`- Intent: ${intent}`);

  const ctx = env.context.slice(0, topN).map((s) => `${s.value} [${s.priority}]`).join(", ");
  if (ctx) lines.push(`- In scope: ${ctx}`);

  const imp = env.importance.slice(0, topN).map((s) => s.value).join(", ");
  if (imp) lines.push(`- Importance: ${imp}`);

  const conf = env.confidence[0];
  if (conf) lines.push(`- Confidence: ${conf.value}`);

  const inter = env.interaction[0];
  if (inter) lines.push(`- Style: ${inter.value}`);

  return lines.join("\n");
}

/**
 * One-line render for realtime voice context seeding.
 */
export function renderForVoice(env: SignalEnvelope): string {
  const intent = env.intent[0]?.value ?? "ask";
  const ctx = env.context[0]?.value ?? "no specific scope";
  const style = env.interaction[0]?.value ?? "advisory";
  return `Context: intent=${intent}, scope=${ctx}, style=${style}.`;
}

/**
 * Structured render for UI debug drawer.
 */
export function renderForUI(env: SignalEnvelope) {
  return {
    builtAt: env.builtAt,
    buckets: {
      intent: env.intent,
      context: env.context,
      importance: env.importance,
      confidence: env.confidence,
      interaction: env.interaction,
    },
  };
}
