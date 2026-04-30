import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { TopOfMind } from "@/hooks/useDailyBriefing";
import { WhyThisSheet } from "./WhyThisSheet";

interface TopOfMindCardProps {
  topOfMind: TopOfMind | null;
  loading?: boolean;
}

/**
 * The one calm hero card. Always rendered — if nothing matters, it tells you.
 */
export function TopOfMindCard({ topOfMind, loading }: TopOfMindCardProps) {
  const navigate = useNavigate();
  const [whyOpen, setWhyOpen] = useState(false);

  if (loading && !topOfMind) {
    return (
      <div className="px-6 pb-6">
        <div className="max-w-2xl mx-auto rounded-2xl border border-border/40 bg-card/40 backdrop-blur-md p-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60 mb-3">
            Top of Mind
          </p>
          <p className="text-sm font-light text-muted-foreground/60">Reading the day…</p>
        </div>
      </div>
    );
  }

  if (!topOfMind) return null;

  const strength = topOfMind.signal_strength ?? "medium";
  const pulse = strength === "high" || strength === "critical";

  const doNow = () => {
    const intent = topOfMind.do_now_intent || topOfMind.headline;
    navigate(`/?intent=${encodeURIComponent(intent)}`);
  };

  return (
    <div className="px-6 pb-6">
      <div
        className={cn(
          "max-w-2xl mx-auto relative rounded-2xl border border-border/50 bg-card/50 backdrop-blur-md p-6",
          "shadow-[0_1px_0_0_hsl(var(--foreground)/0.04)]",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70 flex items-center gap-2">
            <span
              className={cn("inline-block w-1.5 h-1.5 rounded-full", dotClass(strength), pulse && "animate-pulse")}
              aria-hidden
            />
            Top of Mind
          </p>
          <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/55">
            {strength}
          </span>
        </div>

        {/* Headline */}
        <p className="text-xl sm:text-2xl font-light leading-snug tracking-tight text-foreground/90 mb-3">
          {topOfMind.headline}
        </p>

        {/* Why now + time */}
        <p className="text-sm text-muted-foreground/85 leading-relaxed mb-5">
          {topOfMind.why_now}
          {typeof topOfMind.est_minutes === "number" && (
            <span className="text-muted-foreground/55"> · ~{topOfMind.est_minutes} min</span>
          )}
        </p>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={doNow}
            className="px-4 py-2 rounded-full bg-foreground text-background text-xs font-medium hover:bg-foreground/90 transition-colors"
          >
            Do it now
          </button>
          <button
            type="button"
            onClick={doNow}
            className="text-xs text-muted-foreground/80 hover:text-foreground underline-offset-4 hover:underline"
          >
            Snooze 1h
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setWhyOpen(true)}
            className="text-[11px] text-muted-foreground/70 hover:text-foreground underline-offset-4 hover:underline"
          >
            Why this?
          </button>
        </div>
      </div>

      <WhyThisSheet
        open={whyOpen}
        onClose={() => setWhyOpen(false)}
        title={topOfMind.headline}
        why={topOfMind.why_this}
      />
    </div>
  );
}

function dotClass(s: TopOfMind["signal_strength"]): string {
  if (s === "critical") return "bg-foreground";
  if (s === "high") return "bg-foreground/80";
  if (s === "medium") return "bg-foreground/50";
  return "bg-foreground/30";
}
