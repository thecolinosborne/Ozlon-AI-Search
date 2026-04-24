import { cn } from "@/lib/utils";

interface SummaryChipProps {
  unread: number;
  needsReply: number;
  total: number;
  active: boolean;
  onToggle: () => void;
}

export function SummaryChip({ unread, needsReply, total, active, onToggle }: SummaryChipProps) {
  if (total === 0) return null;
  const parts: string[] = [];
  if (unread > 0) parts.push(`${unread} unread`);
  if (needsReply > 0) parts.push(`${needsReply} need reply`);
  if (parts.length === 0) parts.push(`${total} message${total === 1 ? "" : "s"}`);

  return (
    <button
      onClick={onToggle}
      className={cn(
        "w-full text-left px-4 lg:px-6 py-2 flex items-center gap-2 group",
      )}
      aria-pressed={active}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-primary/70" />
      <span className="text-[12px] text-muted-foreground group-hover:text-foreground transition-colors">
        {parts.join(" · ")}
      </span>
      {needsReply > 0 ? (
        <span
          className={cn(
            "ml-auto text-[11px] font-medium px-2 py-0.5 rounded-full transition-colors",
            active
              ? "bg-primary text-primary-foreground"
              : "text-primary hover:bg-primary/10",
          )}
        >
          {active ? "Showing replies" : "Focus replies →"}
        </span>
      ) : null}
    </button>
  );
}
