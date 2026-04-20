import { useState } from "react";
import { RotateCw, CheckCircle2, XCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  getModelLabel,
  getProviderIcon,
  formatLatency,
  formatCost,
} from "@/lib/modelLabels";
import type { ProviderUsedEvent, ToolUsedInfo } from "@/services/chatService";

interface RoutingChipProps {
  provider: ProviderUsedEvent;
  toolsUsed?: ToolUsedInfo[];
}

const MODE_LABEL: Record<string, string> = {
  speed: "Speed",
  balanced: "Balanced",
  quality: "Quality",
};

export const RoutingChip = ({ provider, toolsUsed }: RoutingChipProps) => {
  const [open, setOpen] = useState(false);
  const { name, provider: family } = getModelLabel(provider.model);
  const Icon = getProviderIcon(family);
  const latency = formatLatency(provider.latency_ms);
  const cost = formatCost(provider.cost_estimate);
  const isYourKey = provider.source === "your_key";
  const fallbackUsed = provider.fallback_used === true;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full",
            "bg-muted/40 hover:bg-muted/60 border border-border/30",
            "text-[10px] text-muted-foreground/80 transition-colors",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
          aria-label={`Routed via ${name}`}
        >
          <Icon className="w-2.5 h-2.5" />
          <span className="font-medium text-foreground/80">{name}</span>
          <span className="text-muted-foreground/40">·</span>
          <span
            className={cn(
              isYourKey ? "text-emerald-500/90" : "text-muted-foreground/60"
            )}
          >
            {isYourKey ? "your key" : "ozlon"}
          </span>
          {latency && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-muted-foreground/70">{latency}</span>
            </>
          )}
          {fallbackUsed && (
            <RotateCw className="w-2.5 h-2.5 text-amber-500/90 ml-0.5" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-72 p-3 text-xs space-y-2"
      >
        <div className="flex items-center gap-2 pb-2 border-b border-border/40">
          <Icon className="w-3.5 h-3.5 text-foreground/70" />
          <code className="text-[11px] text-foreground/90 font-mono break-all">
            {provider.model}
          </code>
        </div>

        <div className="space-y-1.5">
          <Row label="Routed via">
            <span
              className={cn(
                isYourKey ? "text-emerald-500" : "text-muted-foreground"
              )}
            >
              {isYourKey ? "Your API key" : "Ozlon gateway"}
            </span>
          </Row>

          {provider.routing_mode && (
            <Row label="Mode">
              {MODE_LABEL[provider.routing_mode] ?? provider.routing_mode}
            </Row>
          )}

          {provider.reason && (
            <Row label="Why">
              <span className="text-foreground/80">{provider.reason}</span>
            </Row>
          )}

          {latency && <Row label="Latency">{latency}</Row>}

          {cost && <Row label="Cost">{cost}</Row>}
        </div>

        {fallbackUsed && provider.fallback_chain && provider.fallback_chain.length > 0 && (
          <div className="pt-2 border-t border-border/40 space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Fallback chain
            </div>
            <div className="space-y-1">
              {provider.fallback_chain.map((entry, idx) => {
                const ok = entry.status === "succeeded";
                return (
                  <div key={idx} className="flex items-start gap-1.5">
                    {ok ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-500 mt-0.5 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-3 h-3 text-destructive/80 mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-foreground/80 truncate">
                        {getModelLabel(entry.model).name}
                      </div>
                      {entry.error && (
                        <div className="text-[10px] text-muted-foreground/70 truncate">
                          {entry.error}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {toolsUsed && toolsUsed.length > 0 && (
          <div className="pt-2 border-t border-border/40 space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Tools used
            </div>
            <div className="flex flex-wrap gap-1">
              {toolsUsed.map((t) => (
                <span
                  key={t.name}
                  className="px-1.5 py-0.5 rounded bg-muted/60 text-[10px] text-foreground/70"
                  title={t.name}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
      {label}
    </span>
    <span className="text-right text-foreground/85">{children}</span>
  </div>
);
