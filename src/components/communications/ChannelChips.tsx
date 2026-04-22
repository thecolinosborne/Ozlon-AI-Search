import { cn } from "@/lib/utils";
import { channelTint } from "./channelStyle";
import type { CommChannel } from "@/hooks/useCommunicationsFeed";

export type ChipFilter = "all" | CommChannel;

interface ChannelChipsProps {
  value: ChipFilter;
  onChange: (v: ChipFilter) => void;
  counts: Record<CommChannel, number>;
  total: number;
}

const ORDER: { value: ChipFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "email", label: "Email" },
  { value: "slack", label: "Slack" },
  { value: "sms", label: "SMS" },
  { value: "voicemail", label: "Voicemail" },
];

export function ChannelChips({ value, onChange, counts, total }: ChannelChipsProps) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
      {ORDER.map((opt) => {
        const active = value === opt.value;
        const count = opt.value === "all" ? total : counts[opt.value];
        const tint = opt.value === "all" ? null : channelTint(opt.value);
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[12px] font-medium transition-colors border",
              active
                ? "bg-foreground text-background border-foreground"
                : "bg-card/40 text-muted-foreground hover:text-foreground border-border/30 backdrop-blur-xl",
            )}
          >
            {tint && (
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: tint }}
                aria-hidden
              />
            )}
            <span>{opt.label}</span>
            {count > 0 && (
              <span
                className={cn(
                  "tabular-nums text-[10px]",
                  active ? "text-background/70" : "text-muted-foreground/60",
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
