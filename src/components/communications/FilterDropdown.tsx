import { ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type FilterValue = "all" | "unread" | "needs-reply";

const OPTIONS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "All states" },
  { value: "unread", label: "Unread" },
  { value: "needs-reply", label: "Needs reply" },
];

interface FilterDropdownProps {
  value: FilterValue;
  onChange: (v: FilterValue) => void;
}

export function FilterDropdown({ value, onChange }: FilterDropdownProps) {
  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-card/50 transition-colors">
          <span>{current.label}</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-card/90 backdrop-blur-xl border-border/40">
        {OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onClick={() => onChange(o.value)}
            className="text-sm flex items-center justify-between gap-4"
          >
            <span>{o.label}</span>
            {o.value === value && <Check className="w-3.5 h-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
