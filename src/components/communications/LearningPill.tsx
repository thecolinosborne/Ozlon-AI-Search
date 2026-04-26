import { useState } from "react";
import { Brain, Check, X, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSignalLearning } from "@/hooks/useSignalLearning";
import { cn } from "@/lib/utils";

/**
 * LearningPill — Phase E visibility surface.
 *
 * A tiny calm pill in the comms header that shows the user the Wisdom Engine
 * is learning from their triage. Reveals (a) what patterns it has internalized
 * this week and (b) pending throttle proposals it wants them to confirm.
 *
 * Stays invisible until there's something to show — silence is the default.
 */
export function LearningPill() {
  const { patterns, proposals, feedbackCount, acceptProposal, dismissProposal } =
    useSignalLearning();
  const [open, setOpen] = useState(false);

  const hasProposals = proposals.length > 0;
  const hasPatterns = patterns.length > 0;

  // Silent if there's nothing meaningful to surface
  if (!hasProposals && !hasPatterns && feedbackCount === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "h-7 px-2.5 inline-flex items-center gap-1.5 rounded-full text-[11px] font-medium border transition-colors",
            hasProposals
              ? "bg-primary/15 text-primary border-primary/30 hover:bg-primary/25"
              : "bg-card/40 text-muted-foreground hover:text-foreground border-border/30",
          )}
          aria-label="Wisdom Engine learning summary"
        >
          <Brain className="w-3 h-3" />
          <span>Learning</span>
          {hasProposals && (
            <span className="ml-0.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold tabular-nums flex items-center justify-center">
              {proposals.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[320px] p-0 bg-popover/95 backdrop-blur-2xl border-border/30"
      >
        <div className="px-4 pt-3.5 pb-2.5 border-b border-border/20">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <h3 className="text-[12.5px] font-medium text-foreground">
              What I'm learning
            </h3>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {feedbackCount > 0
              ? `${feedbackCount} signal${feedbackCount === 1 ? "" : "s"} responded to in the last 7 days.`
              : "Calibrating from your responses…"}
          </p>
        </div>

        {hasProposals && (
          <div className="px-4 py-3 border-b border-border/20 space-y-2.5">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70 font-medium">
              Pending decisions
            </div>
            {proposals.map((p) => (
              <div
                key={p.id}
                className="rounded-xl bg-card/50 border border-border/30 px-3 py-2.5"
              >
                <p className="text-[12px] font-medium text-foreground leading-snug">
                  {p.title}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1 leading-snug line-clamp-3">
                  {p.description}
                </p>
                <div className="flex items-center gap-1.5 mt-2.5">
                  <button
                    onClick={() => acceptProposal(p.id)}
                    className="flex-1 h-7 inline-flex items-center justify-center gap-1 rounded-full bg-primary/15 text-primary text-[11px] font-medium hover:bg-primary/25 transition-colors"
                  >
                    <Check className="w-3 h-3" />
                    Apply
                  </button>
                  <button
                    onClick={() => dismissProposal(p.id)}
                    className="flex-1 h-7 inline-flex items-center justify-center gap-1 rounded-full bg-card/60 text-muted-foreground text-[11px] font-medium hover:text-foreground border border-border/30 transition-colors"
                  >
                    <X className="w-3 h-3" />
                    Not now
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {hasPatterns && (
          <div className="px-4 py-3 space-y-1.5">
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70 font-medium">
              Patterns internalized
            </div>
            {patterns.map((pat) => (
              <div key={pat.id} className="flex items-start gap-2">
                <div className="w-1 h-1 rounded-full bg-primary/60 mt-1.5 shrink-0" />
                <p className="text-[11.5px] text-foreground/85 leading-snug flex-1">
                  {pat.summary}
                  {pat.recurrence > 1 && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground/70 tabular-nums">
                      ×{pat.recurrence}
                    </span>
                  )}
                </p>
              </div>
            ))}
          </div>
        )}

        {!hasProposals && !hasPatterns && (
          <div className="px-4 py-4 text-[11.5px] text-muted-foreground text-center">
            Keep responding to Signals — patterns will appear here as I learn.
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
