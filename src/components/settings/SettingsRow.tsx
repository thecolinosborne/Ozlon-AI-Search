import { ChevronRight, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";

export interface SettingsRowProps {
  icon: LucideIcon;
  label: string;
  description?: string;
  type?: "navigate" | "toggle" | "action";
  value?: boolean;
  onChange?: (value: boolean) => void;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  actionLabel?: string;
}

export const SettingsRow = ({
  icon: Icon,
  label,
  description,
  type = "navigate",
  value,
  onChange,
  onClick,
  disabled = false,
  destructive = false,
  actionLabel,
}: SettingsRowProps) => {
  const handleClick = () => {
    if (disabled) return;
    if (type !== "toggle" && onClick) {
      onClick();
    }
  };

  const handleToggle = (checked: boolean) => {
    if (disabled) return;
    if (onChange) {
      onChange(checked);
    }
  };

  // Use div for toggle type to avoid button-in-button issue
  const Wrapper = type === "toggle" ? "div" : "button";

  return (
    <Wrapper
      onClick={type !== "toggle" ? handleClick : undefined}
      disabled={type !== "toggle" ? disabled : undefined}
      className={cn(
        "w-full flex items-center gap-4 p-4 rounded-2xl transition-all duration-200",
        "bg-card/60 hover:bg-card/80 border border-border/30",
        disabled && "opacity-50 cursor-not-allowed",
        destructive && "hover:bg-destructive/10",
        type !== "toggle" && "cursor-pointer"
      )}
    >
      <div className={cn(
        "p-2.5 rounded-xl",
        destructive ? "bg-destructive/10" : "bg-muted/60"
      )}>
        <Icon className={cn(
          "w-5 h-5",
          destructive ? "text-destructive" : "text-foreground/70"
        )} strokeWidth={1.5} />
      </div>
      
      <div className="flex-1 text-left">
        <p className={cn(
          "font-medium",
          destructive ? "text-destructive" : "text-foreground"
        )}>
          {label}
        </p>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>

      {type === "toggle" && (
        <Switch
          checked={value}
          onCheckedChange={handleToggle}
          disabled={disabled}
        />
      )}
      
      {type === "navigate" && (
        <ChevronRight className="w-5 h-5 text-muted-foreground" />
      )}

      {type === "action" && actionLabel && (
        <span className="text-sm text-primary font-medium">{actionLabel}</span>
      )}
    </Wrapper>
  );
};