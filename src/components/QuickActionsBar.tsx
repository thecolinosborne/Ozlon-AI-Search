import { DollarSign, Calendar, Mail, Utensils, Sparkles, MessageCircle } from "lucide-react";

interface QuickActionsBarProps {
  onAction: (action: string) => void;
}

const quickActions = [
  { icon: DollarSign, label: "Help me with money", intent: "money_help" },
  { icon: Calendar, label: "What's due soon?", intent: "due_soon" },
  { icon: Utensils, label: "Find food nearby", intent: "food_nearby" },
  { icon: Sparkles, label: "Daily summary", intent: "daily_summary" },
];

export const QuickActionsBar = ({ onAction }: QuickActionsBarProps) => {
  return (
    <div className="overflow-x-auto pb-2 px-6 scrollbar-hide transition-opacity duration-300">
      <div className="flex gap-3 min-w-max">
        {quickActions.map((action, index) => (
          <button
            key={index}
            onClick={() => onAction(action.intent)}
            className="flex items-center gap-3 px-6 py-4 rounded-full bg-background/60 backdrop-blur-md border border-border/40 text-sm text-foreground/80 hover:bg-background/80 hover:border-border/60 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] whitespace-nowrap shadow-md"
            style={{ boxShadow: "var(--button-glow)" }}
          >
            <action.icon className="w-5 h-5 stroke-[1.5]" />
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
};
