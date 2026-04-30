import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useTodayLayer } from "@/hooks/useTodayLayer";
import { useSignals } from "@/hooks/useSignals";

/**
 * Today hero — the calm "Jarvis" pane.
 *
 * Layered above the existing Signals page (additive). Renders:
 *   - a breathing orb
 *   - one short sentence of "what's happening now" (now_line_state)
 *   - up to 3 life-event dots ("also today")
 *
 * It deliberately does NOT replace anything below it. The existing capture
 * composer, daily digest, and signal hero continue to render underneath.
 */
export function TodayHero() {
  const { nowLine, events, narrate, narrating } = useTodayLayer();
  const { topMoment } = useSignals();
  const [askedNarrate, setAskedNarrate] = useState(false);

  // Ask for a fresh narration once on mount if the line is stale or empty.
  useEffect(() => {
    if (askedNarrate) return;
    const stale =
      !nowLine?.text ||
      Date.now() - new Date(nowLine.updated_at ?? 0).getTime() > 5 * 60_000;
    if (stale) {
      setAskedNarrate(true);
      void narrate();
    }
  }, [nowLine, narrate, askedNarrate]);

  const upcoming = useMemo(() => events.slice(0, 3), [events]);

  // Plain-speak relative time, e.g. "in 6 days", "today", "in 2 hours"
  const relative = (iso: string | null): string => {
    if (!iso) return "";
    const d = new Date(iso).getTime() - Date.now();
    const mins = Math.round(d / 60000);
    if (mins < -60) return `${Math.round(-mins / 60)}h ago`;
    if (mins < 0) return "just now";
    if (mins < 60) return `in ${mins}m`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `in ${hours}h`;
    const days = Math.round(hours / 24);
    if (days === 1) return "tomorrow";
    if (days < 7) return `in ${days} days`;
    if (days < 30) return `in ${Math.round(days / 7)}w`;
    return `in ${Math.round(days / 30)}mo`;
  };

  // Fallback line if the server hasn't narrated yet
  const line =
    nowLine?.text?.trim() ||
    (topMoment?.headline ?? "All quiet. I'll let you know when something needs you.");

  return (
    <div className="px-6 pt-16 pb-6">
      <div className="max-w-2xl mx-auto flex flex-col items-center text-center">
        {/* Breathing orb */}
        <div className="relative w-16 h-16 mb-6" aria-hidden>
          <div
            className={cn(
              "absolute inset-0 rounded-full bg-foreground/10 backdrop-blur-sm",
              "animate-pulse",
            )}
          />
          <div className="absolute inset-2 rounded-full bg-foreground/20" />
          <div className="absolute inset-5 rounded-full bg-foreground/40" />
        </div>

        {/* The single live sentence — this is the heart of Today */}
        <p
          className={cn(
            "text-xl sm:text-2xl font-light leading-snug tracking-tight text-foreground/90 max-w-lg",
            narrating && "opacity-60",
          )}
        >
          {line}
        </p>

        {/* Life-event "also today" dots */}
        {upcoming.length > 0 && (
          <div className="mt-8 flex flex-col gap-2 items-center">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50">
              Also coming up
            </p>
            <ul className="flex flex-col gap-1.5 items-center">
              {upcoming.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-2 text-xs text-muted-foreground/80"
                >
                  <span className="inline-block w-1 h-1 rounded-full bg-foreground/40" aria-hidden />
                  <span className="text-foreground/70">{e.title}</span>
                  {e.next_due_at && (
                    <span className="text-muted-foreground/50">· {relative(e.next_due_at)}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
