import { Reply, Clock, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { channelTint } from "./channelStyle";
import { Linkify } from "@/lib/linkify";
import type { PriorityItem, TriageUrgency } from "@/hooks/useCommunicationsFeed";

interface PriorityCardProps {
  priority: PriorityItem;
  onClick?: () => void;
  onReply?: (p: PriorityItem) => void;
  onSnooze?: (p: PriorityItem) => void;
  onDone?: (p: PriorityItem) => void;
}

const URGENCY_DOT: Record<TriageUrgency, string> = {
  high: "bg-destructive",
  medium: "bg-amber-500",
  low: "bg-muted-foreground/40",
};

export function PriorityCard({ priority, onClick, onReply, onSnooze, onDone }: PriorityCardProps) {
  const tint = channelTint(priority.channel);
  const hasActions = !!(onReply || onSnooze || onDone);
  const showReply =
    onReply &&
    (priority.actionHint === "reply" || priority.actionHint === undefined);
  const showSnooze = onSnooze && priority.actionHint !== "done";
  const showDone = onDone;

  return (
    <div
      className={cn(
        "w-full text-left flex flex-col gap-2 px-3 py-2.5 rounded-xl",
        "bg-background/40 border border-border/20",
        "transition-colors group",
        onClick && "hover:bg-background/70 cursor-pointer",
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex items-center gap-2 w-full">
        {priority.urgency ? (
          <span
            className={cn("w-1.5 h-1.5 rounded-full shrink-0", URGENCY_DOT[priority.urgency])}
            aria-label={`${priority.urgency} urgency`}
          />
        ) : (
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: tint }}
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          <span className="text-sm text-foreground font-medium">{priority.who}</span>
          <span className="text-sm text-muted-foreground"> · <Linkify text={priority.what} /></span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 shrink-0">
          {priority.channelLabel}
        </span>
      </div>

      {priority.reason ? (
        <p className="text-[11px] text-muted-foreground/80 leading-snug pl-3.5">
          {priority.reason}
        </p>
      ) : null}

      {hasActions ? (
        <div className="flex items-center gap-1.5 pl-3.5 pt-0.5" onClick={(e) => e.stopPropagation()}>
          {showReply ? (
            <button
              onClick={() => onReply!(priority)}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-primary/15 text-primary text-[11px] font-medium hover:bg-primary/25 active:bg-primary/30 transition-colors"
              aria-label="Reply"
            >
              <Reply className="w-3 h-3" />
              Reply
            </button>
          ) : null}
          {showSnooze ? (
            <button
              onClick={() => onSnooze!(priority)}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-card/60 text-muted-foreground text-[11px] font-medium border border-border/30 hover:text-foreground transition-colors"
              aria-label="Snooze 1 hour"
            >
              <Clock className="w-3 h-3" />
              1h
            </button>
          ) : null}
          {showDone ? (
            <button
              onClick={() => onDone!(priority)}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-card/60 text-muted-foreground text-[11px] font-medium border border-border/30 hover:text-foreground transition-colors"
              aria-label="Mark done"
            >
              <Check className="w-3 h-3" />
              Done
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
