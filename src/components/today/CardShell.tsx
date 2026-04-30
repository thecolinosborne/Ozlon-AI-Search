import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SignalStrength } from "@/hooks/useDailyBriefing";

interface CardShellProps {
  label: string;
  value: string;
  aiLine: string;
  actionLabel: string;
  onAction?: () => void;
  onAskWhy?: () => void;
  onOpen?: () => void;
  signalStrength?: SignalStrength;
  className?: string;
  /** Extra slot under the value (e.g. tiny progress bar). */
  meta?: ReactNode;
  /** When true, the card is empty/clear — render in muted state. */
  clear?: boolean;
}

/**
 * Calm glass card used by every command-center tile.
 * Status dot · label · value · AI interpretation · one inline action · "Why this?"
 */
export function CardShell({
  label,
  value,
  aiLine,
  actionLabel,
  onAction,
  onAskWhy,
  onOpen,
  signalStrength = "low",
  className,
  meta,
  clear,
}: CardShellProps) {
  const dot = dotClass(signalStrength, clear);
  const pulse = !clear && signalStrength === "critical";

  return (
    <div
      className={cn(
        "group relative rounded-2xl border border-border/40 bg-card/40 backdrop-blur-md",
        "p-4 flex flex-col gap-2 text-left transition-colors",
        "hover:bg-card/60",
        className,
      )}
    >
      {/* Header: dot + label, optional open hit */}
      <button
        type="button"
        onClick={onOpen}
        className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70 hover:text-foreground/80 transition-colors"
      >
        <span className={cn("inline-block w-1.5 h-1.5 rounded-full", dot, pulse && "animate-pulse")} aria-hidden />
        <span>{label}</span>
      </button>

      {/* Value */}
      <p className={cn("text-sm font-light leading-snug", clear ? "text-muted-foreground/50" : "text-foreground/90")}>
        {value}
      </p>

      {meta}

      {/* One AI interpretation line */}
      {aiLine && (
        <p className={cn("text-xs leading-relaxed", clear ? "text-muted-foreground/40" : "text-muted-foreground/80")}>
          {aiLine}
        </p>
      )}

      {/* Inline actions */}
      <div className="mt-1 flex items-center justify-between">
        {!clear && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="text-xs text-foreground/80 hover:text-foreground underline-offset-4 hover:underline"
          >
            {actionLabel}
          </button>
        ) : (
          <span aria-hidden />
        )}
        {onAskWhy && !clear && (
          <button
            type="button"
            onClick={onAskWhy}
            className="text-[10px] text-muted-foreground/60 hover:text-foreground/80 underline-offset-4 hover:underline"
          >
            Why this?
          </button>
        )}
      </div>
    </div>
  );
}

function dotClass(s: SignalStrength, clear?: boolean): string {
  if (clear) return "bg-muted-foreground/20";
  if (s === "critical") return "bg-foreground";
  if (s === "high") return "bg-foreground/80";
  if (s === "medium") return "bg-foreground/50";
  return "bg-foreground/30";
}
