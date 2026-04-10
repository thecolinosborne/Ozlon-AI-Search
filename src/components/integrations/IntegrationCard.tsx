import { useNavigate } from "react-router-dom";
import { LucideIcon, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { IntegrationStatusBadge } from "./IntegrationStatusBadge";
import type { IntegrationStatus } from "@/stores/useIntegrationsStore";

interface IntegrationCardProps {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  status: IntegrationStatus;
  lastSync: string | null;
  path: string;
}

export const IntegrationCard = ({ name, description, icon: Icon, status, lastSync, path }: IntegrationCardProps) => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(path)}
      className={cn(
        "w-full text-left p-5 rounded-2xl border border-border/40 bg-card/80 backdrop-blur-sm",
        "hover:border-primary/20 hover:shadow-md hover:-translate-y-0.5",
        "transition-all duration-300 group"
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="p-2.5 rounded-xl bg-muted/60 group-hover:bg-primary/10 transition-colors">
          <Icon className="w-5 h-5 text-foreground/70 group-hover:text-primary transition-colors" strokeWidth={1.5} />
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-foreground/60 transition-colors" />
      </div>

      <h3 className="font-semibold text-foreground mb-1">{name}</h3>
      <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{description}</p>

      <div className="flex items-center justify-between">
        <IntegrationStatusBadge status={status} />
        {lastSync && (
          <span className="text-[10px] text-muted-foreground/60">
            Synced {new Date(lastSync).toLocaleDateString()}
          </span>
        )}
      </div>
    </button>
  );
};
