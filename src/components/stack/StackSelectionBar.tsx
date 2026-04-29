import { Check, Clock, Sunrise, X } from "lucide-react";

interface StackSelectionBarProps {
  count: number;
  onComplete: () => void;
  onSnoozeHour: () => void;
  onSnoozeTomorrow: () => void;
  onDismiss: () => void;
  onClear: () => void;
}

export function StackSelectionBar({
  count,
  onComplete,
  onSnoozeHour,
  onSnoozeTomorrow,
  onDismiss,
  onClear,
}: StackSelectionBarProps) {
  if (count === 0) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-[640px] w-[min(640px,calc(100vw-2rem))]">
      <div className="rounded-2xl border border-border/40 bg-card/60 backdrop-blur-2xl px-3 py-2 flex items-center gap-2 shadow-2xl">
        <span className="text-[12px] font-medium text-foreground/90 tabular-nums px-1.5">
          {count} selected
        </span>
        <span className="w-px h-4 bg-border/40" aria-hidden />
        <button
          type="button"
          onClick={onComplete}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-foreground text-background text-[11.5px] font-medium hover:bg-foreground/90 transition-colors"
        >
          <Check className="w-3 h-3" />
          Complete
        </button>
        <button
          type="button"
          onClick={onSnoozeHour}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-card/70 text-foreground/80 text-[11.5px] border border-border/30 hover:text-foreground transition-colors"
        >
          <Clock className="w-3 h-3" />
          1h
        </button>
        <button
          type="button"
          onClick={onSnoozeTomorrow}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-card/70 text-foreground/80 text-[11.5px] border border-border/30 hover:text-foreground transition-colors"
        >
          <Sunrise className="w-3 h-3" />
          Tomorrow
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-card/70 text-muted-foreground text-[11.5px] border border-border/30 hover:text-foreground transition-colors"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="ml-auto p-1 text-muted-foreground/60 hover:text-foreground transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
