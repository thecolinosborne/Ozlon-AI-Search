import { DollarSign, Calendar, Mail, Utensils, Sparkles, MessageCircle } from "lucide-react";

interface QuickActionsBarProps {
  onAction: (action: string) => void;
}

const quickActions = [
  { icon: DollarSign, label: "Help me with money", intent: "money_help" },
  { icon: Calendar, label: "What's due soon?", intent: "due_soon" },
  { icon: Utensils, label: "Find food nearby", intent: "food_nearby" },
  { icon: Calendar, label: "Show my day", intent: "show_day" },
  { icon: Mail, label: "Check my emails", intent: "check_emails" },
  { icon: Sparkles, label: "Daily summary", intent: "daily_summary" },
  { icon: MessageCircle, label: "Talk to me", intent: "talk" },
];

export const QuickActionsBar = ({ onAction }: QuickActionsBarProps) => {
  return (
    <div className="overflow-x-auto pb-2 px-6 scrollbar-hide">
      <div className="flex gap-3 min-w-max">
        {quickActions.map((action, index) => (
          <button
            key={index}
            onClick={() => onAction(action.intent)}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-background/40 backdrop-blur-sm border border-border/30 text-sm text-foreground/80 hover:bg-background/60 hover:border-border/50 transition-all duration-200 hover:scale-105 whitespace-nowrap shadow-sm"
          >
            <action.icon className="w-4 h-4" />
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
};
