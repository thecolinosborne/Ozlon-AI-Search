import { Inbox, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export type StreamMode = "stream" | "people";

interface StreamModeToggleProps {
  value: StreamMode;
  onChange: (mode: StreamMode) => void;
  className?: string;
}

/**
 * Compact segmented control to switch between the chronological Stream view
 * and the relationship-centric People view.
 */
export function StreamModeToggle({ value, onChange, className }: StreamModeToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="View mode"
      className={cn(
        "inline-flex items-center h-7 p-0.5 rounded-full bg-card/40 border border-border/30",
        className,
      )}
    >
      <ToggleButton
        active={value === "stream"}
        onClick={() => onChange("stream")}
        Icon={Inbox}
        label="Stream"
      />
      <ToggleButton
        active={value === "people"}
        onClick={() => onChange("people")}
        Icon={Users}
        label="People"
      />
    </div>
  );
}

interface ToggleButtonProps {
  active: boolean;
  onClick: () => void;
  Icon: typeof Inbox;
  label: string;
}

function ToggleButton({ active, onClick, Icon, label }: ToggleButtonProps) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[11px] font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}
