import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

interface BriefMeButtonProps {
  durationSec: number;
  onClick: () => void;
}

export function BriefMeButton({ durationSec, onClick }: BriefMeButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl",
        "bg-primary text-primary-foreground font-medium text-sm",
        "shadow-[var(--button-glow)] hover:opacity-90 active:scale-[0.99] transition-all",
      )}
    >
      <Play className="w-4 h-4 fill-current" />
      <span>Brief me</span>
      <span className="text-xs opacity-70">· {durationSec}s</span>
    </button>
  );
}
