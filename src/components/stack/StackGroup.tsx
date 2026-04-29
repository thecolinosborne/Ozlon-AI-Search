import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StackItem } from "@/hooks/useStack";
import { StackRow } from "./StackRow";

interface StackGroupProps {
  label: string;
  items: StackItem[];
  defaultOpen?: boolean;
  maxVisible?: number;
  selection: Set<string>;
  selectionActive: boolean;
  onToggleSelect: (item: StackItem) => void;
  onComplete: (item: StackItem) => void;
  onSnooze: (item: StackItem) => void;
  onDismiss: (item: StackItem) => void;
  onRunAgent: (item: StackItem) => void;
  onOpen: (item: StackItem) => void;
}

export function StackGroup({
  label,
  items,
  defaultOpen = false,
  maxVisible,
  selection,
  selectionActive,
  onToggleSelect,
  onComplete,
  onSnooze,
  onDismiss,
  onRunAgent,
  onOpen,
}: StackGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [showAll, setShowAll] = useState(false);

  if (items.length === 0) return null;

  const visible = !open
    ? []
    : maxVisible && !showAll
      ? items.slice(0, maxVisible)
      : items;
  const overflow = maxVisible ? Math.max(0, items.length - maxVisible) : 0;

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 hover:text-foreground/80 transition-colors"
      >
        <ChevronRight
          className={cn("w-3 h-3 transition-transform", open && "rotate-90")}
          aria-hidden
        />
        <span>{label}</span>
        <span className="tabular-nums opacity-60">· {items.length}</span>
      </button>
      {open && (
        <div className="border-t border-border/30">
          {visible.map((item) => (
            <StackRow
              key={item.id}
              item={item}
              selected={selection.has(item.id)}
              selectionActive={selectionActive}
              onToggleSelect={onToggleSelect}
              onComplete={onComplete}
              onSnooze={onSnooze}
              onDismiss={onDismiss}
              onRunAgent={onRunAgent}
              onOpen={onOpen}
            />
          ))}
          {!showAll && overflow > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full text-left px-4 py-2 text-[11px] text-muted-foreground/60 hover:text-foreground hover:bg-card/30 transition-colors border-b border-border/30"
            >
              +{overflow} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}
