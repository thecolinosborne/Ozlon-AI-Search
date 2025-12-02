import { Sparkles, Calendar, TrendingUp, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuickActionsProps {
  onAction: (intent: string) => void;
}

const actions = [
  { icon: Sparkles, label: "Analyze today", intent: "analyze_today" },
  { icon: FileText, label: "Request summary", intent: "daily_summary" },
  { icon: TrendingUp, label: "Check opportunities", intent: "check_opportunities" },
  { icon: Calendar, label: "Due items", intent: "due_items" },
];

export const QuickActions = ({ onAction }: QuickActionsProps) => {
  return (
    <div className="px-4 pb-4">
      <p className="text-xs text-muted-foreground/70 mb-3 px-1">Quick actions</p>
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {actions.map(({ icon: Icon, label, intent }) => (
          <button
            key={intent}
            onClick={() => onAction(intent)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-full whitespace-nowrap",
              "bg-muted/50 hover:bg-muted border border-border/40",
              "text-sm text-foreground/80 transition-all duration-200",
              "hover:scale-[1.02] active:scale-[0.98]"
            )}
          >
            <Icon className="w-4 h-4" strokeWidth={1.5} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
};
