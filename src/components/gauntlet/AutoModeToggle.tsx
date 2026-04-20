import { Sparkles, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface AutoModeToggleProps {
  mode: "auto" | "manual";
  onChange: (mode: "auto" | "manual") => void;
}

export const AutoModeToggle = ({ mode, onChange }: AutoModeToggleProps) => {
  return (
    <div className="p-1 rounded-2xl border border-border/40 bg-card/60 inline-flex">
      <button
        onClick={() => onChange("auto")}
        className={cn(
          "px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2",
          mode === "auto"
            ? "bg-primary text-primary-foreground shadow"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Sparkles className="w-4 h-4" />
        Auto
        <span className="text-[10px] opacity-70">recommended</span>
      </button>
      <button
        onClick={() => onChange("manual")}
        className={cn(
          "px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2",
          mode === "manual"
            ? "bg-primary text-primary-foreground shadow"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <SlidersHorizontal className="w-4 h-4" />
        Manual
      </button>
    </div>
  );
};
