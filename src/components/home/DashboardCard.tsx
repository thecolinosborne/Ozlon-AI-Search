import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  onClick: () => void;
  variant?: "default" | "primary" | "muted";
}

export const DashboardCard = ({
  title,
  description,
  icon: Icon,
  onClick,
  variant = "default",
}: DashboardCardProps) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full p-5 rounded-3xl text-left transition-all duration-300",
        "hover:scale-[1.02] active:scale-[0.98]",
        "backdrop-blur-md border shadow-lg",
        variant === "default" && "bg-card/60 border-border/40 hover:bg-card/80",
        variant === "primary" && "bg-primary/10 border-primary/30 hover:bg-primary/20",
        variant === "muted" && "bg-muted/40 border-border/30 hover:bg-muted/60"
      )}
    >
      <div className="flex items-start gap-4">
        <div className={cn(
          "p-3 rounded-2xl",
          variant === "primary" ? "bg-primary/20" : "bg-muted/60"
        )}>
          <Icon className={cn(
            "w-5 h-5",
            variant === "primary" ? "text-primary" : "text-foreground/70"
          )} strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-foreground mb-1">{title}</h3>
          <p className="text-sm text-muted-foreground line-clamp-2">{description}</p>
        </div>
      </div>
    </button>
  );
};
