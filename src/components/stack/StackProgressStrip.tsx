interface StackProgressStripProps {
  cleared: number;
  total: number;
}

/**
 * StackProgressStrip — single thin line showing today's clearance ratio.
 * Calm: no chart, no colours beyond foreground.
 */
export function StackProgressStrip({ cleared, total }: StackProgressStripProps) {
  const safeTotal = Math.max(total, cleared, 1);
  const pct = Math.min(100, Math.round((cleared / safeTotal) * 100));
  return (
    <div className="px-4 pt-3 pb-2">
      <div className="flex items-baseline justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
        <span>Cleared today</span>
        <span className="tabular-nums">
          {cleared} / {safeTotal}
        </span>
      </div>
      <div className="mt-1.5 h-[2px] w-full bg-border/40 overflow-hidden rounded-full">
        <div
          className="h-full bg-foreground/60 transition-[width] duration-500"
          style={{ width: `${pct}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}
