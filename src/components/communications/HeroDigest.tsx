import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DailyDigest } from "@/hooks/useCommunicationsFeed";

interface HeroDigestProps {
  digest: DailyDigest;
  collapsed: boolean;
  greeting: string;
  onBrief: () => void;
}

/**
 * Slimmed "Today rail" — desktop only. Just greeting + Brief button.
 * Priorities now live inside the stream as the FocusStack.
 */
export function HeroDigest({ digest, collapsed, greeting, onBrief }: HeroDigestProps) {
  return (
    <div className="px-4 lg:px-6 pt-4 lg:pt-6">
      <div
        className={cn(
          "rounded-3xl bg-card/40 backdrop-blur-xl border border-border/30 shadow-card overflow-hidden transition-all duration-500 ease-out",
          collapsed ? "p-3" : "p-5",
        )}
      >
        <h1 className="text-xl lg:text-2xl font-semibold text-foreground leading-tight">
          {greeting}
        </h1>
        {digest.heroLine && digest.heroLine !== "Loading your day…" ? (
          <p className="mt-1 text-[13px] text-muted-foreground leading-snug">
            {digest.heroLine}
          </p>
        ) : null}

        <button
          onClick={onBrief}
          className="mt-4 w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-full bg-primary/10 text-primary text-[12px] font-medium hover:bg-primary/20 active:scale-[0.99] transition-all"
          aria-label="Play daily brief"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Brief me ({digest.briefDurationSec || 45}s)
        </button>
      </div>
    </div>
  );
}
