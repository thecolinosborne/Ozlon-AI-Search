import { cn } from "@/lib/utils";
import type { IntegrationStatus } from "@/stores/useIntegrationsStore";

const statusConfig: Record<IntegrationStatus, { dot: string; text: string; label: string }> = {
  connected: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", label: "Connected" },
  disconnected: { dot: "bg-muted-foreground/40", text: "text-muted-foreground", label: "Not Connected" },
  syncing: { dot: "bg-primary animate-pulse", text: "text-primary", label: "Syncing" },
  error: { dot: "bg-destructive", text: "text-destructive", label: "Error" },
};

export const IntegrationStatusBadge = ({ status }: { status: IntegrationStatus }) => {
  const config = statusConfig[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", config.text)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
};
