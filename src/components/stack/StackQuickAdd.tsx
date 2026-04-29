import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { useSignals } from "@/hooks/useSignals";
import { toast } from "sonner";

/**
 * StackQuickAdd — minimal capture composer pinned to the bottom of /stack.
 * Reuses signals-create so the Brain triages the new item into the right kind.
 */
export function StackQuickAdd() {
  const { createSignal } = useSignals();
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || posting) return;
    setPosting(true);
    try {
      const res = await createSignal(trimmed);
      if (res.ok) {
        setText("");
        toast.success("Added to the stack");
      } else {
        toast.error("Couldn't add — try again");
      }
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="sticky bottom-0 left-0 right-0 px-4 py-3 bg-background/85 backdrop-blur-2xl border-t border-border/40">
      <div className="max-w-2xl mx-auto flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Add to the stack — task, reminder, thought…"
          rows={1}
          className="flex-1 resize-none rounded-xl border border-border/40 bg-card/40 px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground/40 transition-colors"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={posting || !text.trim()}
          aria-label="Add to stack"
          className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl bg-foreground text-background disabled:opacity-30 hover:bg-foreground/90 transition-colors"
        >
          {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
