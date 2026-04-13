import { cn } from "@/lib/utils";
import { UserSettings } from "@/services/chatService";

export type QuickAction = {
  label: string;
  intent: string;
  message: string;
  integration?: string;
};

export const QUICK_ACTIONS: QuickAction[] = [
  { label: "Check Money", intent: "CHECK_MONEY", message: "Check my financial situation and balances.", integration: "banking" },
  { label: "Check Mail", intent: "CHECK_MAIL", message: "Check my email and summarize anything important.", integration: "email" },
  { label: "Daily Digest", intent: "DAILY_DIGEST", message: "Give me a daily digest of my schedule, tasks, and priorities.", integration: "calendar" },
];

interface QuickActionsBarProps {
  onAction: (action: QuickAction) => void;
  disabled?: boolean;
  variant: "hero" | "floating";
  userSettings: UserSettings;
}

export const QuickActionsBar = ({ onAction, disabled, variant, userSettings }: QuickActionsBarProps) => {
  const filtered = QUICK_ACTIONS.filter((action) => {
    if (!action.integration) return true;
    return userSettings.integrations?.[action.integration as keyof NonNullable<UserSettings["integrations"]>];
  });

  if (filtered.length === 0) return null;

  if (variant === "hero") {
    return (
      <div className="flex flex-wrap justify-center gap-2 mt-6 px-4">
        {filtered.map((action) => (
          <button
            key={action.intent}
            onClick={() => onAction(action)}
            disabled={disabled}
            className={cn(
              "px-4 py-2.5 text-sm font-medium rounded-full",
              "bg-neutral-100 text-neutral-700",
              "hover:bg-neutral-200 hover:shadow-sm",
              "transition-all duration-200",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {action.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="fixed bottom-24 left-0 right-0 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {filtered.map((action) => (
            <button
              key={action.intent}
              onClick={() => onAction(action)}
              disabled={disabled}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap",
                "bg-white border border-neutral-200 text-neutral-600",
                "hover:bg-neutral-50 hover:border-neutral-300",
                "transition-all duration-200",
                "disabled:opacity-50"
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
