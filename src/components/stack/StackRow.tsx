import { useState, useCallback, useRef } from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StackItem } from "@/hooks/useStack";
import { useSwipeActions } from "@/hooks/useSwipeActions";

interface StackRowProps {
  item: StackItem;
  selected?: boolean;
  selectionActive?: boolean;
  onToggleSelect?: (item: StackItem) => void;
  onComplete?: (item: StackItem) => void;
  onSnooze?: (item: StackItem) => void;
  onDismiss?: (item: StackItem) => void;
  onRunAgent?: (item: StackItem) => void;
  onOpen?: (item: StackItem) => void;
}

const URGENCY_STRIPE: Record<StackItem["urgency"], string> = {
  high: "bg-amber-500/40",
  medium: "bg-primary/30",
  low: "bg-transparent",
};

export function StackRow({
  item,
  selected = false,
  selectionActive = false,
  onToggleSelect,
  onComplete,
  onSnooze,
  onDismiss,
  onRunAgent,
  onOpen,
}: StackRowProps) {
  const [completing, setCompleting] = useState(false);
  const longPressTimer = useRef<number | null>(null);

  // Swipe: right = done, left = snooze 1h.
  const swipe = useSwipeActions({
    onSwipeRight: () => handleCheck(),
    onSwipeLeft: () => onSnooze?.(item),
  });

  const handleCheck = useCallback(() => {
    if (completing) return;
    setCompleting(true);
    // Optimistic strikethrough → 400ms → fire complete.
    window.setTimeout(() => {
      onComplete?.(item);
    }, 280);
  }, [completing, item, onComplete]);

  const handlePointerDown = useCallback(() => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      onToggleSelect?.(item);
    }, 500);
  }, [item, onToggleSelect]);

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      if (selectionActive) {
        onToggleSelect?.(item);
        return;
      }
      // Shift-click toggles selection too.
      if (e.shiftKey) {
        onToggleSelect?.(item);
        return;
      }
      onOpen?.(item);
    },
    [item, onOpen, onToggleSelect, selectionActive],
  );

  const sourceLabel = item.channel ?? item.source;

  return (
    <div
      className={cn(
        "group relative overflow-hidden border-b border-border/30 transition-all",
        completing && "opacity-40",
        selected && "bg-card/40",
      )}
      style={{
        maxHeight: completing ? 0 : 240,
        transitionProperty: "max-height, opacity",
        transitionDuration: "400ms",
      }}
    >
      {/* Urgency stripe */}
      <span
        className={cn(
          "absolute left-0 top-2 bottom-2 w-[2px] rounded-r",
          URGENCY_STRIPE[item.urgency],
        )}
        aria-hidden
      />

      <div
        className="flex items-start gap-3 px-3 py-3 pl-4 cursor-pointer hover:bg-card/30 transition-colors"
        style={{ transform: `translateX(${swipe.offset}px)` }}
        {...swipe.handlers}
        onClick={handleRowClick}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen?.(item);
          else if (e.key === " ") {
            e.preventDefault();
            handleCheck();
          } else if (e.key === "e") handleCheck();
          else if (e.key === "s") onSnooze?.(item);
        }}
      >
        {/* Checkbox */}
        <button
          type="button"
          aria-label={completing ? "Marked done" : "Mark done"}
          onClick={(e) => {
            e.stopPropagation();
            handleCheck();
          }}
          className={cn(
            "shrink-0 mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center transition-colors",
            completing
              ? "bg-foreground border-foreground"
              : "border-foreground/30 hover:border-foreground/70",
          )}
        >
          {completing && <Check className="w-2.5 h-2.5 text-background" strokeWidth={3} />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60">
            <span>{sourceLabel}</span>
            {item.who && (
              <>
                <span>·</span>
                <span className="text-foreground/60 normal-case tracking-normal">{item.who}</span>
              </>
            )}
            <span>·</span>
            <span className="tabular-nums">{Math.round(item.score * 100)}%</span>
          </div>
          <p
            className={cn(
              "text-[13.5px] text-foreground/90 leading-snug mt-0.5",
              completing && "line-through text-muted-foreground/50",
            )}
          >
            {item.headline}
          </p>
          {item.subline && !completing && (
            <p className="text-[11.5px] text-muted-foreground/70 leading-snug mt-0.5 line-clamp-2">
              {item.subline}
            </p>
          )}
          {item.signalRefs.length > 0 && !completing && (
            <p className="text-[10px] text-muted-foreground/50 mt-1">
              +{item.signalRefs.length} related
            </p>
          )}

          {!completing && (
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 opacity-70 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              {item.agentSuggestion && (
                <button
                  type="button"
                  onClick={() => onRunAgent?.(item)}
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-foreground text-background text-[11px] font-medium hover:bg-foreground/90 transition-colors"
                >
                  <Sparkles className="w-2.5 h-2.5" />
                  {item.agentSuggestion.label}
                  <ArrowRight className="w-2.5 h-2.5" />
                </button>
              )}
              {item.primaryAction.kind === "reply" && (
                <button
                  type="button"
                  onClick={() => onRunAgent?.(item)}
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-primary/15 text-primary text-[11px] font-medium hover:bg-primary/25 transition-colors"
                >
                  <Sparkles className="w-2.5 h-2.5" />
                  Reply with AI
                </button>
              )}
              <button
                type="button"
                onClick={() => onSnooze?.(item)}
                className="text-[11px] text-muted-foreground/70 hover:text-foreground underline-offset-4 hover:underline"
              >
                Snooze
              </button>
              <button
                type="button"
                onClick={() => onDismiss?.(item)}
                className="text-[11px] text-muted-foreground/60 hover:text-foreground underline-offset-4 hover:underline"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
