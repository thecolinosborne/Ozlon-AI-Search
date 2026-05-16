import { cn } from "@/lib/utils";

export const RefineChipsRow = ({ chips, onPick, disabled }: {
  chips: string[];
  onPick: (chip: string) => void;
  disabled?: boolean;
}) => (
  <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
    {chips.map((c) => (
      <button
        key={c}
        type="button"
        disabled={disabled}
        onClick={() => onPick(c)}
        className={cn(
          "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium",
          "bg-background/80 border border-border/50 text-foreground/80",
          "hover:bg-background hover:border-border transition-colors",
          "disabled:opacity-40 disabled:cursor-not-allowed",
        )}
      >
        {c}
      </button>
    ))}
  </div>
);
