import { Sparkles, Zap, Inbox, Reply, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSignals, type SignalMoment } from "@/hooks/useSignals";

interface PulseRibbonProps {
  greeting: string;
  unread: number;
  needsReply: number;
  total: number;
  briefDurationSec: number;
  onBrief: () => void;
  onSignalAct?: (signal: SignalMoment) => void;
  className?: string;
}

/**
 * PulseRibbon — next-gen replacement for HeroDigest.
 *
 * A single, scannable horizontal band that fuses:
 *  - Greeting + AI brief CTA
 *  - Live communications metrics (unread, needs-reply, total)
 *  - Top Signal moment (when one exists) — surfaced inline as a high-priority chip
 *
 * Designed to be calm at rest, urgent when something matters.
 */
export function PulseRibbon({
  greeting,
  unread,
  needsReply,
  total,
  briefDurationSec,
  onBrief,
  onSignalAct,
  className,
}: PulseRibbonProps) {
  const { topMoment, respond } = useSignals();

  const hasUrgent = (topMoment?.salience ?? 0) >= 0.7;

  return (
    <div
      className={cn(
        "px-4 lg:px-6 pt-3 pb-2 bg-background/70 backdrop-blur-2xl border-b border-border/20",
        className,
      )}
    >
      {/* Top row: greeting + brief CTA */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[15px] lg:text-[16px] font-medium text-foreground truncate">
            {greeting}
          </h1>
          <p className="text-[11.5px] text-muted-foreground/80 mt-0.5 leading-tight">
            {needsReply > 0 ? (
              <>
                <span className="text-foreground/80 font-medium">{needsReply}</span> need
                {needsReply === 1 ? "s" : ""} reply ·{" "}
                <span className="text-foreground/80 font-medium">{unread}</span> unread
              </>
            ) : unread > 0 ? (
              <>
                <span className="text-foreground/80 font-medium">{unread}</span> unread ·
                you're caught up on replies
              </>
            ) : (
              <>All clear · {total} messages</>
            )}
          </p>
        </div>

        <button
          onClick={onBrief}
          className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-primary/10 text-primary text-[11.5px] font-medium hover:bg-primary/15 active:scale-[0.98] transition-all"
          aria-label="Play daily brief"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Brief · {briefDurationSec || 45}s
        </button>
      </div>

      {/* Metric pulses */}
      <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
        <MetricPulse icon={Inbox} label="Total" value={total} tone="neutral" />
        <MetricPulse
          icon={Reply}
          label="Reply"
          value={needsReply}
          tone={needsReply > 0 ? "primary" : "neutral"}
        />
        <MetricPulse
          icon={AlertCircle}
          label="Unread"
          value={unread}
          tone={unread > 5 ? "warn" : "neutral"}
        />

        {/* Top Signal — inline urgent chip */}
        {topMoment && (
          <button
            onClick={() => {
              if (onSignalAct) onSignalAct(topMoment);
              respond(topMoment.id, "acted");
            }}
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-medium transition-colors ml-auto",
              hasUrgent
                ? "bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20"
                : "bg-card/60 text-muted-foreground border border-border/30 hover:text-foreground",
            )}
            aria-label={`Signal: ${topMoment.headline}`}
            title={topMoment.reason ?? topMoment.headline}
          >
            <Zap className="w-3 h-3" />
            <span className="truncate max-w-[180px]">{topMoment.headline}</span>
          </button>
        )}
      </div>
    </div>
  );
}

interface MetricPulseProps {
  icon: typeof Inbox;
  label: string;
  value: number;
  tone: "neutral" | "primary" | "warn";
}

function MetricPulse({ icon: Icon, label, value, tone }: MetricPulseProps) {
  const toneClass =
    tone === "primary"
      ? "bg-primary/10 text-primary border-primary/20"
      : tone === "warn"
        ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
        : "bg-card/40 text-muted-foreground border-border/30";

  return (
    <div
      className={cn(
        "shrink-0 inline-flex items-center gap-1.5 h-7 px-2 rounded-full border text-[11px] font-medium",
        toneClass,
      )}
    >
      <Icon className="w-3 h-3" />
      <span className="tabular-nums">{value}</span>
      <span className="text-muted-foreground/70">{label}</span>
    </div>
  );
}
