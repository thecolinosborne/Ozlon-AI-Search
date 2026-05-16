import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  current: number;
  baseline: number;
  trend: "falling" | "rising" | "flat";
  size?: "sm" | "md";
}

export const PriceTrendBadge = ({ current, baseline, trend, size = "sm" }: Props) => {
  const delta = current - baseline;
  const pct = baseline ? Math.round((delta / baseline) * 100) : 0;
  const Icon = trend === "falling" ? ArrowDown : trend === "rising" ? ArrowUp : Minus;
  const tone =
    trend === "falling"
      ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40"
      : trend === "rising"
      ? "text-amber-600 bg-amber-50 dark:bg-amber-950/40"
      : "text-muted-foreground bg-muted/50";
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full font-medium",
      tone,
      size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
    )}>
      <Icon className="w-3 h-3" />
      {delta < 0 ? `$${Math.abs(delta)} vs typical` : `${pct >= 0 ? "+" : ""}${pct}%`}
    </span>
  );
};

export const Sparkline = ({ points, trend }: { points: number[]; trend: string }) => {
  if (!points?.length) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * 60;
      const y = 16 - ((p - min) / range) * 14;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const color = trend === "falling" ? "stroke-emerald-500" : trend === "rising" ? "stroke-amber-500" : "stroke-muted-foreground";
  return (
    <svg width="60" height="16" className="opacity-70">
      <path d={path} fill="none" strokeWidth="1.5" className={color} strokeLinecap="round" />
    </svg>
  );
};
