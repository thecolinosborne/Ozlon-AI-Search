import { cn } from "@/lib/utils";
import { channelTint } from "./channelStyle";
import type { PriorityItem } from "@/hooks/useCommunicationsFeed";

interface PriorityCardProps {
  priority: PriorityItem;
  onClick?: () => void;
}

export function PriorityCard({ priority, onClick }: PriorityCardProps) {
  const tint = channelTint(priority.channel);
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl",
        "bg-background/40 hover:bg-background/70 border border-border/20",
        "transition-colors group",
      )}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: tint }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <span className="text-sm text-foreground font-medium">{priority.who}</span>
        <span className="text-sm text-muted-foreground"> · {priority.what}</span>
      </div>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 shrink-0">
        {priority.channelLabel}
      </span>
    </button>
  );
}
