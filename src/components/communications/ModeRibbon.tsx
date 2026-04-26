import { Brain, Coffee, Compass, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CognitiveMode } from "@/hooks/useCurrentMode";

interface ModeRibbonProps {
  mode: CognitiveMode;
  cognitiveLoad: number;
  needsReply: number;
  /** When true, the user has explicitly opted into a denser surface. */
  overridden?: boolean;
  onToggleOverride?: () => void;
}

const MODE_COPY: Record<
  CognitiveMode,
  { label: string; hint: string; Icon: typeof Brain; tone: string }
> = {
  focus: {
    label: "Focus mode",
    hint: "Holding non-urgent noise. Only the top priority shown.",
    Icon: Brain,
    tone: "from-primary/15 to-primary/5 border-primary/25 text-primary",
  },
  planning: {
    label: "Planning mode",
    hint: "Full triage view. Take your time.",
    Icon: Compass,
    tone: "from-accent/15 to-accent/5 border-accent/25 text-accent-foreground",
  },
  reactive: {
    label: "Reactive mode",
    hint: "Surfacing what changed since you last looked.",
    Icon: Zap,
    tone: "from-amber-500/15 to-amber-500/5 border-amber-500/25 text-amber-600 dark:text-amber-400",
  },
  idle: {
    label: "Resting",
    hint: "Inbox is calm. We'll nudge you if something matters.",
    Icon: Coffee,
    tone: "from-muted/40 to-muted/10 border-border/40 text-muted-foreground",
  },
};

/**
 * Phase F — calm awareness strip that whispers the user's current mode and,
 * when warranted, offers a one-tap escape hatch ("Show everything").
 *
 * Hidden entirely when nothing useful would be said (idle + empty inbox).
 */
export function ModeRibbon({
  mode,
  cognitiveLoad,
  needsReply,
  overridden,
  onToggleOverride,
}: ModeRibbonProps) {
  // Stay silent when there's nothing to say.
  if (mode === "idle" && needsReply === 0) return null;

  const { label, hint, Icon, tone } = MODE_COPY[mode];
  const showOverride = mode === "focus" && needsReply > 1;
  const loadPct = Math.round(Math.max(0, Math.min(1, cognitiveLoad)) * 100);

  return (
    <div className="px-4 lg:px-6 pt-2">
      <div
        className={cn(
          "rounded-2xl border bg-gradient-to-br backdrop-blur-xl px-3.5 py-2.5 flex items-center gap-3",
          tone
        )}
        role="status"
        aria-live="polite"
      >
        <div className="w-7 h-7 rounded-full bg-background/50 flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold tracking-tight">{label}</span>
            <span className="text-[10px] uppercase tracking-[0.16em] opacity-60">
              {loadPct}% load
            </span>
          </div>
          <p className="text-[11px] opacity-80 truncate">{hint}</p>
        </div>
        {showOverride && onToggleOverride ? (
          <button
            onClick={onToggleOverride}
            className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-background/60 hover:bg-background/80 border border-border/30 transition-colors shrink-0"
          >
            {overridden ? "Re-focus" : "Show all"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
