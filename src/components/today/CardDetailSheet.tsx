import { ReactNode } from "react";
import { X } from "lucide-react";

interface CardDetailSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Short AI interpretation — same line shown on the card. */
  aiLine?: string;
  /** Body content: full list, etc. */
  children: ReactNode;
  /** Action buttons row at the bottom. */
  actions?: ReactNode;
}

/**
 * Bottom sheet that opens when a card is tapped.
 * Never navigates the page — keeps the Now Line in view behind it.
 */
export function CardDetailSheet({ open, onClose, title, aiLine, children, actions }: CardDetailSheetProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-background border border-border/60 shadow-2xl flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 pb-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70 mb-1">
              {title}
            </p>
            {aiLine && (
              <p className="text-sm font-light text-foreground/90 leading-snug">{aiLine}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full hover:bg-muted/50"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 pb-3 overflow-y-auto flex-1">
          {children}
        </div>

        {actions && (
          <div className="px-5 py-3 border-t border-border/40 flex items-center justify-end gap-2">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
