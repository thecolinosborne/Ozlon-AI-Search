// Lightweight client-side mirror of supabase/functions/_shared/signals/render.ts
// for consumers (like RealtimeVoiceChat) that don't have access to the server
// envelope. Stays in sync by being intentionally minimal — only the values
// actually visible in the browser.

export interface ClientVoiceContext {
  systemName: string;
  topSignal?: {
    headline: string;
    suggested_direction?: string | null;
    salience: number;
  } | null;
  liveSignalCount?: number;
}

/**
 * Single-line voice context seed. Mirrors `renderForVoice(env)` semantics.
 * Use to prime a realtime session on connect.
 */
export function renderForVoiceClient(ctx: ClientVoiceContext): string {
  const parts: string[] = [];
  parts.push(`You are ${ctx.systemName}, the user's calm voice operator.`);
  if (ctx.liveSignalCount && ctx.liveSignalCount > 0) {
    parts.push(`${ctx.liveSignalCount} live signal${ctx.liveSignalCount === 1 ? "" : "s"} pending.`);
  }
  if (ctx.topSignal) {
    const urgent = ctx.topSignal.salience >= 0.85 ? " (urgent)" : "";
    parts.push(`Most relevant${urgent}: ${ctx.topSignal.headline}.`);
    if (ctx.topSignal.suggested_direction) {
      parts.push(`Suggested direction: ${ctx.topSignal.suggested_direction}.`);
    }
  }
  parts.push("Hold this context. Mention it only if it serves the user.");
  return parts.join(" ");
}
