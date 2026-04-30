import { X } from "lucide-react";
import type { WhyThis } from "@/hooks/useDailyBriefing";

interface WhyThisSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  why: WhyThis | null | undefined;
}

/**
 * Plain-language explanation of why a recommendation surfaced.
 * Five short lines: trigger · connection · matters now · if ignored · fastest next.
 */
export function WhyThisSheet({ open, onClose, title, why }: WhyThisSheetProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-background border border-border/60 shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
            Why I surfaced this
          </p>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full hover:bg-muted/50"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <p className="text-sm font-light text-foreground/90 mb-4">{title}</p>

        <ul className="space-y-2.5 text-xs leading-relaxed text-muted-foreground/85">
          {why?.trigger && <Line label="Trigger" body={why.trigger} />}
          {why?.connection && <Line label="Connection" body={why.connection} />}
          {why?.matters_now && <Line label="Matters now" body={why.matters_now} />}
          {why?.if_ignored && <Line label="If ignored" body={why.if_ignored} />}
          {why?.fastest_next && <Line label="Fastest next" body={why.fastest_next} />}
          {!why && <li className="text-muted-foreground/50">No explanation available yet.</li>}
        </ul>
      </div>
    </div>
  );
}

function Line({ label, body }: { label: string; body: string }) {
  return (
    <li>
      <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/55 mr-2">
        {label}
      </span>
      <span className="text-foreground/85">{body}</span>
    </li>
  );
}
