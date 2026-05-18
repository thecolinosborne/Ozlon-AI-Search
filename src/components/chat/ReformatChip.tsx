import { Wand2, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { FormatMode } from "@/services/chatService";

const MODES: Array<{
  mode: FormatMode;
  label: string;
  hint: string;
}> = [
  { mode: "ATOMIC", label: "Atomic", hint: "One precise line" },
  { mode: "CHAT", label: "Chat", hint: "Natural conversation" },
  { mode: "BRIEF", label: "Brief", hint: "Tight, scannable" },
  { mode: "EXECUTION", label: "Script", hint: "Step-by-step plan" },
  { mode: "DOCUMENT", label: "Document", hint: "Structured doc" },
  { mode: "LONGFORM", label: "Longform", hint: "Deep narrative" },
];

interface ReformatChipProps {
  current?: FormatMode;
  disabled?: boolean;
  onSelect: (mode: FormatMode) => void;
}

export const ReformatChip = ({ current, disabled, onSelect }: ReformatChipProps) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title="Reformat as"
          aria-label="Reformat as"
          className={cn(
            "inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors",
            "text-muted-foreground hover:text-foreground hover:bg-muted/60",
            "disabled:opacity-40 disabled:cursor-not-allowed"
          )}
        >
          <Wand2 className="w-3.5 h-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80">
          Reformat as
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {MODES.map(({ mode, label, hint }) => {
          const active = current === mode;
          return (
            <DropdownMenuItem
              key={mode}
              onSelect={(e) => {
                e.preventDefault();
                if (!active) onSelect(mode);
              }}
              className="flex items-start gap-2 py-2 cursor-pointer"
            >
              <div className="flex-shrink-0 w-4 mt-0.5">
                {active ? <Check className="w-3.5 h-3.5 text-primary" /> : null}
              </div>
              <div className="flex flex-col">
                <span className="text-sm leading-tight">{label}</span>
                <span className="text-[11px] text-muted-foreground leading-tight">{hint}</span>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
