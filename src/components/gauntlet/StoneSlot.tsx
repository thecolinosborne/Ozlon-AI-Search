import { CheckCircle2, XCircle, Loader2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProviderRow, StoneCapability } from "@/hooks/useGauntlet";

const PROVIDER_LABELS: Record<string, string> = {
  lovable: "Lovable Gateway",
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Anthropic (Claude)",
  higgsfield: "Higgsfield",
};

const KEY_ENV_NAMES: Record<string, string> = {
  lovable: "LOVABLE_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  higgsfield: "HIGGSFIELD_API_KEY",
};

interface ProviderRowProps {
  provider: string;
  row?: ProviderRow;
  capability?: StoneCapability;
  connected: boolean;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export const StoneSlot = ({ provider, row, capability, connected }: ProviderRowProps) => {
  const label = PROVIDER_LABELS[provider] ?? provider;
  const verifying = !row;
  const isError = row?.status === "error" && connected;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-all",
        connected
          ? "border-border/40 bg-card/60"
          : "border-dashed border-border/30 bg-transparent",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        {connected ? (
          <span
            className={cn(
              "w-2 h-2 rounded-full shrink-0",
              isError ? "bg-destructive" : "bg-primary animate-pulse",
            )}
          />
        ) : (
          <Circle className="w-2.5 h-2.5 text-muted-foreground/40 shrink-0" strokeWidth={1.5} />
        )}
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground truncate">{label}</div>
          {connected ? (
            <div className="text-[11px] text-muted-foreground truncate">
              {capability?.keyTail && <>••••{capability.keyTail}</>}
              {capability?.keyTail && row?.last_verified_at && " · "}
              {row?.last_verified_at && <>verified {formatRelative(row.last_verified_at)}</>}
              {!capability?.keyTail && !row?.last_verified_at && "key detected"}
            </div>
          ) : (
            <div className="text-[11px] text-muted-foreground truncate">
              Add {KEY_ENV_NAMES[provider]} to enable
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0">
        {verifying ? (
          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
        ) : isError ? (
          <XCircle className="w-4 h-4 text-destructive" />
        ) : connected ? (
          <CheckCircle2 className="w-4 h-4 text-primary" />
        ) : null}
      </div>
    </div>
  );
};
