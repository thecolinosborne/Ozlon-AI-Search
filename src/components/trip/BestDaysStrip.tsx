import type { BestDay } from "./types";
import { cn } from "@/lib/utils";

export const BestDaysStrip = ({ days, onPick }: { days: BestDay[]; onPick?: (d: BestDay) => void }) => (
  <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
    {days.map((d) => (
      <button
        key={d.date}
        type="button"
        onClick={() => onPick?.(d)}
        className={cn(
          "shrink-0 flex flex-col items-center min-w-[58px] py-1.5 px-2 rounded-lg border transition-colors",
          d.tier === "low" && "bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
          d.tier === "mid" && "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
          d.tier === "high" && "bg-muted/50 border-border/40 text-muted-foreground",
        )}
      >
        <span className="text-[10px] font-medium uppercase tracking-wide opacity-80">{d.label}</span>
        <span className="text-sm font-semibold tabular-nums">${d.price_usd}</span>
      </button>
    ))}
  </div>
);
