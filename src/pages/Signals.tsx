import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, X } from "lucide-react";
import { SignalSurface } from "@/components/signals/SignalSurface";
import { useSignals } from "@/hooks/useSignals";

export default function Signals() {
  const { moments, synthesizing, synthesize, dismissAll } = useSignals();

  return (
    <div className="relative min-h-screen bg-background">
      <Link
        to="/"
        className="fixed top-6 left-6 z-50 p-2 rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
        aria-label="Back"
      >
        <ArrowLeft className="w-4 h-4" />
      </Link>

      <div className="fixed top-6 right-6 z-50 flex items-center gap-1 text-[11px] text-muted-foreground/70">
        {synthesizing && (
          <span className="px-2 py-1 tracking-wide opacity-70">Listening…</span>
        )}
        <button
          type="button"
          onClick={() => synthesize()}
          disabled={synthesizing}
          className="p-2 rounded-full hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
          aria-label="Refresh signals"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${synthesizing ? "animate-spin" : ""}`} />
        </button>
        {moments.length > 0 && (
          <button
            type="button"
            onClick={() => dismissAll()}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="Dismiss all signals"
          >
            <X className="w-3 h-3" />
            <span>Clear all</span>
          </button>
        )}
      </div>

      <SignalSurface variant="page" maxMoments={1} showList />
    </div>
  );
}
