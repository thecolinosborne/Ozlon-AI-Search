import { CheckCircle2, XCircle, Loader2, Zap, Eye, Image as ImageIcon, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import type { ProviderRow, StoneCapability } from "@/hooks/useGauntlet";

const PROVIDER_LABELS: Record<string, string> = {
  lovable: "Lovable Gateway",
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Anthropic",
};

interface StoneSlotProps {
  provider: string;
  row?: ProviderRow;
  capability?: StoneCapability;
  onToggle: (provider: string, status: "active" | "disabled") => void;
}

export const StoneSlot = ({ provider, row, capability, onToggle }: StoneSlotProps) => {
  const status = row?.status ?? "disabled";
  const isActive = status === "active";
  const isError = status === "error";
  const verifying = !row && provider !== "lovable";

  return (
    <div
      className={cn(
        "p-4 rounded-2xl border transition-all",
        isActive ? "border-primary/40 bg-primary/5" : "border-border/40 bg-card/60",
        isError && "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-2 h-2 rounded-full",
            isActive ? "bg-primary animate-pulse" : isError ? "bg-destructive" : "bg-muted-foreground/40"
          )} />
          <span className="text-sm font-medium text-foreground">{PROVIDER_LABELS[provider] ?? provider}</span>
        </div>
        <div className="flex items-center gap-2">
          {verifying && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />}
          {isActive && <CheckCircle2 className="w-4 h-4 text-primary" />}
          {isError && <XCircle className="w-4 h-4 text-destructive" />}
          <Switch
            checked={isActive}
            onCheckedChange={(v) => onToggle(provider, v ? "active" : "disabled")}
            disabled={provider === "lovable"}
          />
        </div>
      </div>

      {capability && (
        <div className="grid grid-cols-4 gap-2 text-[10px] text-muted-foreground">
          <CapStat icon={Brain} label="Reason" value={capability.reasoning} />
          <CapStat icon={Eye} label="Vision" value={capability.vision} />
          <CapStat icon={ImageIcon} label="Image" value={capability.image} />
          <CapStat icon={Zap} label="Speed" value={capability.speed} />
        </div>
      )}

      {row?.last_error && (
        <p className="mt-2 text-[10px] text-destructive truncate">{row.last_error}</p>
      )}
    </div>
  );
};

const CapStat = ({ icon: Icon, label, value }: { icon: any; label: string; value: number }) => (
  <div className="flex flex-col items-center gap-0.5">
    <Icon className="w-3 h-3" strokeWidth={1.5} />
    <span className="font-medium text-foreground">{value || "—"}</span>
    <span>{label}</span>
  </div>
);
