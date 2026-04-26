import { useState } from "react";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSignals } from "@/hooks/useSignals";

interface SignalsBannerProps {
  /** Minimum salience to surface as a fusion banner (default 0.7). */
  threshold?: number;
  /** Called when the user accepts the suggested direction. */
  onAct?: (payload: { headline: string; suggestion: string | null }) => void;
}

/**
 * SignalsBanner — Phase D fusion layer.
 *
 * Renders a calm, dismissible banner inside the communications stream when
 * a high-salience Signal moment is live. Acts as the bridge between the
 * Wisdom Engine's awareness layer and the comms execution surface.
 */
export function SignalsBanner({ threshold = 0.7, onAct }: SignalsBannerProps) {
  const { topMoment, respond } = useSignals();
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (!topMoment) return null;
  if ((topMoment.salience ?? 0) < threshold) return null;
  if (dismissed === topMoment.id) return null;

  const isUrgent = topMoment.salience >= 0.85;

  const handleAct = () => {
    onAct?.({
      headline: topMoment.headline,
      suggestion: topMoment.suggested_direction,
    });
    respond(topMoment.id, "acted");
  };

  const handleDismiss = () => {
    setDismissed(topMoment.id);
    respond(topMoment.id, "dismissed");
  };

  return (
    <div className="px-4 lg:px-6 pt-3">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border backdrop-blur-2xl px-3.5 py-3 flex items-start gap-3 transition-colors",
          isUrgent
            ? "bg-amber-500/[0.06] border-amber-500/25"
            : "bg-primary/[0.05] border-primary/20",
        )}
      >
        {/* Pulse accent */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 w-[3px]",
            isUrgent ? "bg-amber-400/60" : "bg-primary/50",
          )}
          aria-hidden
        />

        <div
          className={cn(
            "shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center",
            isUrgent
              ? "bg-amber-500/15 text-amber-300"
              : "bg-primary/12 text-primary",
          )}
        >
          <Sparkles className="w-3.5 h-3.5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-[10px] uppercase tracking-[0.18em] font-medium",
                isUrgent ? "text-amber-300/80" : "text-primary/80",
              )}
            >
              {isUrgent ? "Signal · urgent" : "Signal"}
            </span>
            <span className="text-[10px] text-muted-foreground/60 tabular-nums">
              {Math.round(topMoment.salience * 100)}%
            </span>
          </div>
          <p className="text-[13.5px] text-foreground font-medium mt-0.5 leading-snug">
            {topMoment.headline}
          </p>
          {topMoment.reason && (
            <p className="text-[11.5px] text-muted-foreground/85 mt-1 leading-snug line-clamp-2">
              {topMoment.reason}
            </p>
          )}

          {topMoment.suggested_direction && (
            <button
              onClick={handleAct}
              className={cn(
                "mt-2 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11.5px] font-medium transition-colors",
                isUrgent
                  ? "bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                  : "bg-primary/15 text-primary hover:bg-primary/25",
              )}
            >
              <span className="truncate max-w-[260px]">
                {topMoment.suggested_direction}
              </span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>

        <button
          onClick={handleDismiss}
          className="shrink-0 p-1 -m-1 text-muted-foreground/50 hover:text-foreground transition-colors"
          aria-label="Dismiss signal"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
