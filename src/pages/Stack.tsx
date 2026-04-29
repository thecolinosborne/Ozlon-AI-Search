import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Layers, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useStack, type StackItem } from "@/hooks/useStack";
import { StackProgressStrip } from "@/components/stack/StackProgressStrip";
import { StackGroup } from "@/components/stack/StackGroup";
import { StackSelectionBar } from "@/components/stack/StackSelectionBar";
import { StackQuickAdd } from "@/components/stack/StackQuickAdd";

/**
 * Stack — the unified actionable inbox. Phase 1 surface: signals + comm
 * priorities + captures, ranked by the urgency engine, grouped Now/Soon/
 * Later/Snoozed/Done today, with bulk actions and undo.
 */
export default function Stack() {
  const stack = useStack();
  const [selection, setSelection] = useState<Set<string>>(new Set());

  const selectionActive = selection.size > 0;
  const selectedItems = stack.items.filter((it) => selection.has(it.id));

  const toggleSelect = useCallback((item: StackItem) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelection(new Set()), []);

  // Single-item with undo toast.
  const completeWithUndo = useCallback(
    async (item: StackItem) => {
      await stack.complete(item);
      toast.success("Done", {
        description: item.headline.slice(0, 80),
        action: {
          label: "Undo",
          onClick: () => {
            // Restore by refreshing — Phase 1 has no per-item revert API.
            void stack.refresh();
          },
        },
      });
    },
    [stack],
  );

  const snoozeWithUndo = useCallback(
    async (item: StackItem) => {
      await stack.snooze(item, 60);
      toast("Snoozed for 1 hour", {
        action: { label: "Undo", onClick: () => void stack.refresh() },
      });
    },
    [stack],
  );

  const dismissWithUndo = useCallback(
    async (item: StackItem) => {
      await stack.dismiss(item);
      toast("Dismissed", {
        action: { label: "Undo", onClick: () => void stack.refresh() },
      });
    },
    [stack],
  );

  // Bulk handlers
  const bulkComplete = useCallback(async () => {
    const items = selectedItems;
    clearSelection();
    await stack.completeMany(items);
    toast.success(`${items.length} cleared`, {
      action: { label: "Undo", onClick: () => void stack.refresh() },
    });
  }, [selectedItems, stack, clearSelection]);

  const bulkSnooze = useCallback(
    async (minutes: number, label: string) => {
      const items = selectedItems;
      clearSelection();
      await stack.snoozeMany(items, minutes);
      toast(`${items.length} snoozed · ${label}`, {
        action: { label: "Undo", onClick: () => void stack.refresh() },
      });
    },
    [selectedItems, stack, clearSelection],
  );

  const bulkDismiss = useCallback(async () => {
    const items = selectedItems;
    clearSelection();
    await stack.dismissMany(items);
    toast(`${items.length} dismissed`, {
      action: { label: "Undo", onClick: () => void stack.refresh() },
    });
  }, [selectedItems, stack, clearSelection]);

  const totalOpen =
    stack.groups.now.length + stack.groups.soon.length + stack.groups.later.length;

  return (
    <div className="relative min-h-screen bg-background flex flex-col">
      <Link
        to="/"
        className="fixed top-6 left-6 z-50 p-2 rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
        aria-label="Back"
      >
        <ArrowLeft className="w-4 h-4" />
      </Link>

      <div className="fixed top-6 right-6 z-50 flex items-center gap-1 text-[11px] text-muted-foreground/70">
        <Link
          to="/signals"
          className="px-2 py-1 rounded-full hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          Signals
        </Link>
        <Link
          to="/communications"
          className="px-2 py-1 rounded-full hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          Comms
        </Link>
        <button
          type="button"
          onClick={() => void stack.refresh()}
          className="p-2 rounded-full hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="pt-20 pb-2 px-4">
        <div className="max-w-2xl mx-auto flex items-center gap-2">
          <Layers className="w-4 h-4 text-foreground/70" />
          <h1 className="text-xl font-light tracking-tight">The Stack</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto w-full">
        <StackProgressStrip
          cleared={stack.clearedToday}
          total={stack.clearedToday + totalOpen}
        />
      </div>

      <div className="max-w-2xl mx-auto w-full flex-1 mt-2 pb-32">
        {totalOpen === 0 && stack.groups.snoozed.length === 0 ? (
          <div className="px-6 py-20 text-center">
            <p className="text-sm text-muted-foreground/70 font-light">
              Nothing on the stack. The system will surface what matters.
            </p>
          </div>
        ) : (
          <div className="border-t border-border/40">
            <StackGroup
              label="Now"
              items={stack.groups.now}
              defaultOpen
              maxVisible={5}
              selection={selection}
              selectionActive={selectionActive}
              onToggleSelect={toggleSelect}
              onComplete={completeWithUndo}
              onSnooze={snoozeWithUndo}
              onDismiss={dismissWithUndo}
              onRunAgent={stack.runAgent}
              onOpen={stack.openSource}
            />
            <StackGroup
              label="Soon"
              items={stack.groups.soon}
              defaultOpen
              selection={selection}
              selectionActive={selectionActive}
              onToggleSelect={toggleSelect}
              onComplete={completeWithUndo}
              onSnooze={snoozeWithUndo}
              onDismiss={dismissWithUndo}
              onRunAgent={stack.runAgent}
              onOpen={stack.openSource}
            />
            <StackGroup
              label="Later"
              items={stack.groups.later}
              selection={selection}
              selectionActive={selectionActive}
              onToggleSelect={toggleSelect}
              onComplete={completeWithUndo}
              onSnooze={snoozeWithUndo}
              onDismiss={dismissWithUndo}
              onRunAgent={stack.runAgent}
              onOpen={stack.openSource}
            />
            <StackGroup
              label="Snoozed"
              items={stack.groups.snoozed}
              selection={selection}
              selectionActive={selectionActive}
              onToggleSelect={toggleSelect}
              onComplete={completeWithUndo}
              onSnooze={snoozeWithUndo}
              onDismiss={dismissWithUndo}
              onRunAgent={stack.runAgent}
              onOpen={stack.openSource}
            />
            <StackGroup
              label="Done today"
              items={stack.groups.doneToday}
              selection={selection}
              selectionActive={selectionActive}
              onToggleSelect={toggleSelect}
              onComplete={completeWithUndo}
              onSnooze={snoozeWithUndo}
              onDismiss={dismissWithUndo}
              onRunAgent={stack.runAgent}
              onOpen={stack.openSource}
            />
          </div>
        )}
      </div>

      <StackQuickAdd />

      <StackSelectionBar
        count={selection.size}
        onComplete={bulkComplete}
        onSnoozeHour={() => void bulkSnooze(60, "1h")}
        onSnoozeTomorrow={() => void bulkSnooze(60 * 18, "tomorrow")}
        onDismiss={bulkDismiss}
        onClear={clearSelection}
      />
    </div>
  );
}
