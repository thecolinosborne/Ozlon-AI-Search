import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PriorityCard } from "./PriorityCard";
import { BriefMeButton } from "./BriefMeButton";
import type { DailyDigest } from "@/hooks/useCommunicationsFeed";

interface HeroDigestProps {
  digest: DailyDigest;
  collapsed: boolean;
  greeting: string;
  onBrief: () => void;
}

export function HeroDigest({ digest, collapsed, greeting, onBrief }: HeroDigestProps) {
  return (
    <div className="px-4 lg:px-6 pt-4 lg:pt-6">
      <div
        className={cn(
          "rounded-3xl bg-card/40 backdrop-blur-xl border border-border/30 shadow-card overflow-hidden transition-all duration-500 ease-out",
          collapsed ? "p-3" : "p-5 lg:p-7",
        )}
      >
        {collapsed ? (
          <button
            onClick={onBrief}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium text-foreground truncate">{greeting}</span>
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70 shrink-0">
                · {digest.priorities.length} priorities
              </span>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </button>
        ) : (
          <>
            <h1 className="text-2xl lg:text-3xl font-semibold text-foreground leading-tight">
              {greeting}
            </h1>
            <p className="mt-1 text-base lg:text-lg text-muted-foreground">{digest.heroLine}</p>
            <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground/60">
              {digest.subLine}
            </p>

            <div className="mt-4 space-y-2">
              {digest.priorities.map((p) => (
                <PriorityCard key={p.id} priority={p} />
              ))}
            </div>

            <div className="mt-5">
              <BriefMeButton durationSec={45} onClick={onBrief} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
