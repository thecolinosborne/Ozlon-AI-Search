import { cn } from "@/lib/utils";

interface ChipProps { children: React.ReactNode; tone?: "default" | "good" | "warn" }
export const TrustChip = ({ children, tone = "default" }: ChipProps) => (
  <span className={cn(
    "inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium",
    tone === "good" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    tone === "warn" && "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    tone === "default" && "bg-muted/60 text-foreground/70",
  )}>
    {children}
  </span>
);

export const TrustChips = ({ chips }: { chips: { label: string; tone?: "default" | "good" | "warn" }[] }) => (
  <div className="flex flex-wrap gap-1">
    {chips.map((c, i) => <TrustChip key={i} tone={c.tone}>{c.label}</TrustChip>)}
  </div>
);
