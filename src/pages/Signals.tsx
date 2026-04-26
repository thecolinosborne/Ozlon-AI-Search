import { Link, useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { ArrowLeft, RefreshCw, X, Radar } from "lucide-react";
import { SignalSurface } from "@/components/signals/SignalSurface";
import { useSignals } from "@/hooks/useSignals";

export default function Signals() {
  const { moments, synthesizing, synthesize, scanNow, dismissAll, respond } = useSignals();
  const navigate = useNavigate();

  const digestMoments = useMemo(
    () => moments.filter((m) => m.kind === "digest"),
    [moments],
  );

  // Throttle Scan now: disable if a digest moment was created within last 6h.
  const lastDigestAt = digestMoments[0]?.created_at ?? null;
  const scanCoolingDown = lastDigestAt
    ? Date.now() - new Date(lastDigestAt).getTime() < 6 * 3600_000
    : false;

  const handleHandle = (id: string, intent: string) => {
    respond(id, "acted");
    navigate(`/?intent=${encodeURIComponent(intent)}&signal=${id}`);
  };

  const formatTime = (iso: string) => {
    const diff = (Date.now() - new Date(iso).getTime()) / 60000;
    if (diff < 1) return "just now";
    if (diff < 60) return `${Math.round(diff)}m ago`;
    if (diff < 1440) return `${Math.round(diff / 60)}h ago`;
    return `${Math.round(diff / 1440)}d ago`;
  };

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
          onClick={() => scanNow()}
          disabled={synthesizing || scanCoolingDown}
          title={scanCoolingDown ? "Daily scan available again in a few hours" : "Scan all integrations"}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-full hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
          aria-label="Scan now"
        >
          <Radar className={`w-3.5 h-3.5 ${synthesizing ? "animate-pulse" : ""}`} />
          <span>Scan now</span>
        </button>
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

      {digestMoments.length > 0 && (
        <div className="pt-20 px-6">
          <div className="max-w-2xl mx-auto">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60 mb-4">
              Today · daily scan
            </p>
            <ul className="divide-y divide-border/30 mb-10">
              {digestMoments.map((m) => (
                <li key={m.id} className="py-3 flex items-start gap-3 group">
                  <span className="mt-1.5 inline-block w-1 h-1 rounded-full bg-foreground/40 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60">
                      <span>digest</span>
                      <span>·</span>
                      <span className="tabular-nums">{Math.round(m.salience * 100)}%</span>
                      <span>·</span>
                      <span>{formatTime(m.created_at)}</span>
                    </div>
                    <p className="text-sm text-foreground/90 leading-snug mt-1">{m.headline}</p>
                    {m.reason && (
                      <p className="text-xs text-muted-foreground/80 leading-relaxed mt-1">{m.reason}</p>
                    )}
                    <div className="flex items-center gap-4 mt-2 opacity-60 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => handleHandle(m.id, m.suggested_direction || m.headline)}
                        className="text-sm text-muted-foreground/70 hover:text-foreground transition-colors underline-offset-4 hover:underline"
                      >
                        Handle
                      </button>
                      <button
                        type="button"
                        onClick={() => respond(m.id, "dismissed")}
                        className="text-sm text-muted-foreground/70 hover:text-foreground transition-colors underline-offset-4 hover:underline"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <SignalSurface variant="page" maxMoments={1} showList />
    </div>
  );
}
