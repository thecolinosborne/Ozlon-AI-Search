import { useState } from "react";
import { Play, Pause } from "lucide-react";
import { cn } from "@/lib/utils";

interface VoicemailInlineProps {
  durationSec: number;
}

const BARS = 22;

export function VoicemailInline({ durationSec }: VoicemailInlineProps) {
  const [playing, setPlaying] = useState(false);
  const mins = Math.floor(durationSec / 60);
  const secs = (durationSec % 60).toString().padStart(2, "0");

  return (
    <div
      className="inline-flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full bg-card/50 backdrop-blur-xl border border-border/30"
      onClick={(e) => {
        e.stopPropagation();
        setPlaying((p) => !p);
      }}
    >
      <span className="w-6 h-6 rounded-full bg-foreground/10 flex items-center justify-center">
        {playing ? (
          <Pause className="w-3 h-3 text-foreground" />
        ) : (
          <Play className="w-3 h-3 text-foreground fill-current" />
        )}
      </span>
      <span className="flex items-center gap-[2px] h-4">
        {Array.from({ length: BARS }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "w-[2px] rounded-full bg-foreground/30 transition-all",
              playing && "bg-primary/60",
            )}
            style={{
              height: `${20 + Math.sin(i * 0.9) * 30 + (i % 3) * 15}%`,
            }}
          />
        ))}
      </span>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {mins}:{secs}
      </span>
    </div>
  );
}
