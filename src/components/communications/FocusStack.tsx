import { Reply, Clock, Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { channelTint } from "./channelStyle";
import { Linkify } from "@/lib/linkify";
import type { PriorityItem, TriageUrgency } from "@/hooks/useCommunicationsFeed";

interface FocusStackProps {
  priorities: PriorityItem[];
  onTap?: (p: PriorityItem) => void;
  onReply?: (p: PriorityItem) => void;
  onSnooze?: (p: PriorityItem) => void;
  onDone?: (p: PriorityItem) => void;
}

const URGENCY_DOT: Record<TriageUrgency, string> = {
  high: "bg-destructive",
  medium: "bg-amber-500",
  low: "bg-muted-foreground/40",
};

export function FocusStack({ priorities, onTap, onReply, onSnooze, onDone }: FocusStackProps) {
  const top = priorities.slice(0, 3);
  if (top.length === 0) return null;

  return (
    <div className="px-4 lg:px-6 pt-2 pb-1 space-y-2">
      <div className="flex items-center gap-1.5 px-1">
        <Sparkles className="w-3 h-3 text-primary/70" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
          Focus
        </span>
      </div>
      {top.map((p) => {
        const tint = channelTint(p.channel);
        return (
          <div
            key={p.id}
            className={cn(
              "relative w-full text-left rounded-2xl bg-card/60 border border-border/30 backdrop-blur-xl",
              "p-3 pl-4 transition-colors",
              onTap && "hover:bg-card/80 cursor-pointer",
            )}
            onClick={onTap ? () => onTap(p) : undefined}
            role={onTap ? "button" : undefined}
            tabIndex={onTap ? 0 : undefined}
            onKeyDown={(e) => {
              if (onTap && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onTap(p);
              }
            }}
          >
            {/* Channel tint left edge */}
            <span
              className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r"
              style={{ background: tint }}
              aria-hidden
            />
            <div className="flex items-center gap-2">
              {p.urgency ? (
                <span
                  className={cn("w-1.5 h-1.5 rounded-full shrink-0", URGENCY_DOT[p.urgency])}
                  aria-label={`${p.urgency} urgency`}
                />
              ) : (
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: tint }}
                  aria-hidden
                />
              )}
              <span className="text-[14px] font-medium text-foreground truncate">{p.who}</span>
              <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground/60 shrink-0">
                {p.channelLabel}
              </span>
            </div>
            <p className="mt-1 text-[13.5px] text-foreground/85 leading-snug line-clamp-2">
              <Linkify text={p.what} />
            </p>
            {p.reason ? (
              <p className="mt-0.5 text-[11px] text-muted-foreground/70 line-clamp-1">
                {p.reason}
              </p>
            ) : null}

            <div
              className="mt-2.5 flex items-center gap-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              {onReply ? (
                <button
                  onClick={() => onReply(p)}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-primary text-primary-foreground text-[11.5px] font-medium hover:opacity-90 active:scale-[0.98] transition-all shadow-[var(--button-glow)]"
                  aria-label="Reply with AI"
                >
                  <Sparkles className="w-3 h-3" />
                  Reply with AI
                </button>
              ) : null}
              {onSnooze ? (
                <button
                  onClick={() => onSnooze(p)}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-card/70 text-muted-foreground text-[11.5px] font-medium border border-border/30 hover:text-foreground transition-colors"
                  aria-label="Snooze 1 hour"
                >
                  <Clock className="w-3 h-3" />
                  1h
                </button>
              ) : null}
              {onDone ? (
                <button
                  onClick={() => onDone(p)}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-card/70 text-muted-foreground text-[11.5px] font-medium border border-border/30 hover:text-foreground transition-colors"
                  aria-label="Mark done"
                >
                  <Check className="w-3 h-3" />
                  Done
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
