import { useNavigate } from "react-router-dom";
import { ArrowLeft, LucideIcon } from "lucide-react";
import { IntegrationStatusBadge } from "./IntegrationStatusBadge";
import type { IntegrationStatus } from "@/stores/useIntegrationsStore";

interface IntegrationDetailLayoutProps {
  name: string;
  description: string;
  icon: LucideIcon;
  status: IntegrationStatus;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export const IntegrationDetailLayout = ({
  name,
  description,
  icon: Icon,
  status,
  children,
  actions,
}: IntegrationDetailLayoutProps) => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 pb-24">
      <header className="border-b border-border/50 px-4 py-4 safe-area-top">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate("/integrations")}
            className="p-2 hover:bg-muted rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <div className="flex items-center gap-3 flex-1">
            <div className="p-2 rounded-xl bg-muted/60">
              <Icon className="w-5 h-5 text-foreground/70" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">{name}</h1>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          </div>
          <IntegrationStatusBadge status={status} />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {actions && (
          <div className="flex items-center gap-3">{actions}</div>
        )}
        {children}
      </div>
    </div>
  );
};
