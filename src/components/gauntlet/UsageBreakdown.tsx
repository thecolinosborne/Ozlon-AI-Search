import { cn } from "@/lib/utils";

interface UsageBreakdownProps {
  usage: { stone: string; count: number; pct: number }[];
}

const STONE_COLORS: Record<string, string> = {
  lovable: "bg-primary",
  openai: "bg-emerald-500",
  gemini: "bg-blue-500",
  anthropic: "bg-orange-500",
};

const STONE_LABELS: Record<string, string> = {
  lovable: "Lovable",
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Anthropic",
};

export const UsageBreakdown = ({ usage }: UsageBreakdownProps) => {
  const totalCount = usage.reduce((s, u) => s + u.count, 0);

  return (
    <div className="p-4 rounded-2xl border border-border/40 bg-card/60 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Stone usage</h3>
        <span className="text-[11px] text-muted-foreground">{totalCount} recent calls</span>
      </div>

      {totalCount === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No routing data yet. Make some AI requests.</p>
      ) : (
        <>
          <div className="flex h-2 rounded-full overflow-hidden bg-muted/40">
            {usage.filter(u => u.count > 0).map((u) => (
              <div
                key={u.stone}
                className={cn("h-full transition-all", STONE_COLORS[u.stone] ?? "bg-muted")}
                style={{ width: `${u.pct}%` }}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {usage.map((u) => (
              <div key={u.stone} className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2">
                  <span className={cn("w-2 h-2 rounded-full", STONE_COLORS[u.stone])} />
                  <span className="text-muted-foreground">{STONE_LABELS[u.stone]}</span>
                </div>
                <span className="font-medium text-foreground">{u.pct}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
