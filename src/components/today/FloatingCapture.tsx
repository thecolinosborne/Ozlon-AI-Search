import { useState } from "react";
import { Plus, Loader2, X } from "lucide-react";
import { useTodayLayer } from "@/hooks/useTodayLayer";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Floating "+" that opens a single capture sheet.
 *
 * Whatever you type — a reminder, a person, an event, a task — the server
 * decides what kind of thing it is and stores it in the right table.
 */
export function FloatingCapture() {
  const { capture } = useTodayLayer();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  const submit = async () => {
    const t = text.trim();
    if (!t || posting) return;
    setPosting(true);
    try {
      const res = await capture(t);
      if (res.ok) {
        const kind = (res.data as { kind?: string })?.kind ?? "saved";
        toast.success(`Saved as ${kind.replace("_", " ")}`);
        setText("");
        setOpen(false);
      } else {
        toast.error("Couldn't save — try again");
      }
    } finally {
      setPosting(false);
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add anything"
        className={cn(
          "fixed bottom-24 right-6 z-40 w-12 h-12 rounded-full",
          "bg-foreground text-background shadow-lg",
          "flex items-center justify-center hover:scale-105 active:scale-95",
          "transition-transform",
        )}
      >
        <Plus className="w-5 h-5" />
      </button>

      {/* Sheet */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-background border border-border/60 shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
                Add anything
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded-full hover:bg-muted/50"
                aria-label="Close"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submit();
                }
                if (e.key === "Escape") setOpen(false);
              }}
              rows={3}
              placeholder="Sarah's birthday is March 8 · remind me to call mom tomorrow · dentist every 6 months · book a haircut"
              className="w-full resize-none rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground/30"
            />

            <div className="flex items-center justify-between mt-3">
              <p className="text-[10px] text-muted-foreground/50">
                I'll figure out if it's a person, reminder, or task.
              </p>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={posting || !text.trim()}
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-foreground text-background text-xs font-medium disabled:opacity-30 hover:bg-foreground/90 transition-colors"
              >
                {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
