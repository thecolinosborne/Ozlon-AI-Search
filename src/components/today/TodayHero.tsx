import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useTodayLayer } from "@/hooks/useTodayLayer";
import { useSignals } from "@/hooks/useSignals";
import { useDailyBriefing } from "@/hooks/useDailyBriefing";
import { StatusStrip } from "./StatusStrip";

/**
 * Today hero — the calm chief-of-staff opening.
 *
 *   - breathing orb
 *   - one short sentence (now line)
 *   - status strip: morning · time · capacity
 *
 * The orb and sentence stay the heartbeat. The "Also coming up" dots moved
 * down into the Up Next card in the Command Center.
 */
export function TodayHero() {
  const { nowLine, narrate, narrating } = useTodayLayer();
  const { topMoment } = useSignals();
  const { brief } = useDailyBriefing();
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

  // The brief's now_line takes priority once it arrives — same source the orb
  // uses, so we stay in sync.
  const line =
    brief?.now_line?.trim() ||
    nowLine?.text?.trim() ||
    (topMoment?.headline ?? "All quiet. I'll let you know when something needs you.");

  return (
    <div className="px-6 pt-16 pb-2">
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

        {/* The single live sentence — heart of Today */}
        <p
          className={cn(
            "text-xl sm:text-2xl font-light leading-snug tracking-tight text-foreground/90 max-w-lg",
            narrating && "opacity-60",
          )}
        >
          {line}
        </p>

        {/* Status strip: mode · time · capacity */}
        <StatusStrip
          capacityLabel={brief?.capacity_label}
          dayMode={brief?.day_mode}
        />
      </div>
    </div>
  );
}
