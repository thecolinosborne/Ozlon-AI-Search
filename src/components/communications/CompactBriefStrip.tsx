import { useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { PriorityCard } from "./PriorityCard";
import type { DailyDigest, PriorityItem } from "@/hooks/useCommunicationsFeed";

interface CompactBriefStripProps {
  digest: DailyDigest;
  greeting: string;
  onBrief: () => void;
  onPriorityTap?: (p: PriorityItem) => void;
}

/**
 * Mobile-only compact strip. NO sticky behavior, NO backdrop-blur on the
 * touch surface — avoids the iOS Safari "finger sticking" quirk that the
 * full HeroDigest exhibits inside an overflow-y-auto parent.
 */
export function CompactBriefStrip({
  digest,
  greeting,
  onBrief,
  onPriorityTap,
}: CompactBriefStripProps) {
  const [open, setOpen] = useState(false);
  const count = digest.priorities.length;

  return (
    <div className="px-4 pt-3">
      <div className="rounded-2xl bg-card/60 border border-border/30 overflow-hidden">
        {/* Strip row */}
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-foreground truncate leading-tight">
              {greeting}
            </div>
            {digest.heroLine && digest.heroLine !== "Loading your day…" ? (
              <div className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                {digest.heroLine}
              </div>
            ) : null}
          </div>
          <button
            onClick={onBrief}
            className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-primary/15 text-primary text-[11px] font-medium active:bg-primary/25 transition-colors"
            aria-label="Play daily brief"
          >
            <Sparkles className="w-3 h-3" />
            Brief
          </button>
          {count > 0 ? (
            <button
              onClick={() => setOpen((v) => !v)}
              className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-card text-muted-foreground text-[11px] font-medium border border-border/30 active:text-foreground transition-colors"
              aria-expanded={open}
              aria-label={open ? "Hide priorities" : "Show top priorities"}
            >
              Top {Math.min(count, 3)}
              <ChevronDown
                className={cn(
                  "w-3 h-3 transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>
          ) : null}
        </div>

        {/* Expandable priorities */}
        {open && count > 0 ? (
          <div className="px-2 pb-2 space-y-1.5 border-t border-border/20 pt-2">
            {digest.priorities.slice(0, 3).map((p) => (
              <PriorityCard
                key={p.id}
                priority={p}
                onClick={onPriorityTap ? () => onPriorityTap(p) : undefined}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
