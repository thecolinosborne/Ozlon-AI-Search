import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface OnboardingOptionProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  description?: string;
}

export const OnboardingOption = ({
  label,
  selected,
  onClick,
  description,
}: OnboardingOptionProps) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full p-5 rounded-2xl text-left transition-all duration-300 border relative group",
        selected
          ? "bg-primary/10 border-primary/40 shadow-sm"
          : "bg-card/40 border-border/30 hover:bg-card/60 hover:border-border/50"
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <span className={cn(
            "font-medium text-lg transition-colors",
            selected ? "text-primary" : "text-foreground"
          )}>
            {label}
          </span>
          {description && (
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          )}
        </div>
        {selected && (
          <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
            <Check className="w-4 h-4 text-primary-foreground" />
          </div>
        )}
      </div>
    </button>
  );
};
