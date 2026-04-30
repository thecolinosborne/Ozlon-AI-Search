import { Link, useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { ArrowLeft, RefreshCw, X, Radar, Send, Loader2 } from "lucide-react";
import { SignalSurface } from "@/components/signals/SignalSurface";
import { useSignals } from "@/hooks/useSignals";
import { TodayHero } from "@/components/today/TodayHero";
import { FloatingCapture } from "@/components/today/FloatingCapture";
import { TopOfMindCard } from "@/components/today/TopOfMindCard";
import { CommandCenter } from "@/components/today/CommandCenter";
import { useDailyBriefing } from "@/hooks/useDailyBriefing";
import { toast } from "sonner";

export default function Signals() {
  const { moments, synthesizing, synthesize, scanNow, dismissAll, respond, createSignal } = useSignals();
  const navigate = useNavigate();
  const [composerText, setComposerText] = useState("");
  const [posting, setPosting] = useState(false);

  const digestMoments = useMemo(
    () => moments.filter((m) => m.kind === "digest"),
    [moments],
  );
  const userCaptures = useMemo(
    () => moments.filter((m) => m.kind === "user_created"),
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

  const handleCapture = async () => {
    const text = composerText.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const res = await createSignal(text);
      if (res.ok) {
        setComposerText("");
        const stone = (res.data as { brain?: { stone?: string } })?.brain?.stone;
        toast.success(stone ? `Captured · triaged by ${stone}` : "Captured");
      } else {
        toast.error("Couldn't capture — try again");
      }
    } finally {
      setPosting(false);
    }
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
        <Link
          to="/stack"
          className="px-2 py-1 rounded-full hover:text-foreground hover:bg-muted/50 transition-colors"
          title="Open The Stack — unified actionable inbox"
        >
          The Stack
        </Link>
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

      {/* Today layer — Stage 1: living "now line" + life-event preview. Additive. */}
      <TodayHero />

      {/* Capture composer — flags pressing items for the Brain to triage. */}
      <div className="pt-4 px-6">
        <div className="max-w-2xl mx-auto">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60 mb-3">
            Capture · The Brain triages
          </p>
          <div className="flex items-start gap-2">
            <textarea
              value={composerText}
              onChange={(e) => setComposerText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handleCapture();
                }
              }}
              placeholder="What's pressing? e.g. 'Reply to Jamie about the contract' or 'Don't forget Q3 review prep'"
              rows={2}
              className="flex-1 resize-none rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground/30 transition-colors"
            />
            <button
              type="button"
              onClick={() => void handleCapture()}
              disabled={posting || !composerText.trim()}
              className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl bg-foreground text-background disabled:opacity-30 hover:bg-foreground/90 transition-colors"
              aria-label="Capture signal"
            >
              {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-1.5">
            ⌘ + Enter to capture · The Brain auto-decides if it's a task, a message, a reminder, or just a thought.
          </p>
        </div>
      </div>

      {/* User captures section — newest first, action chips inline. */}
      {userCaptures.length > 0 && (
        <div className="px-6 mt-10">
          <div className="max-w-2xl mx-auto">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/60 mb-4">
              Your captures · {userCaptures.length}
            </p>
            <ul className="divide-y divide-border/30">
              {userCaptures.map((m) => {
                const md = (m.metadata ?? {}) as Record<string, unknown>;
                const sigType = (md.signal_type as string) ?? "thought";
                const stone = md.brain_stone as string | undefined;
                const validated = md.validated === true;
                return (
                  <li key={m.id} className="py-4 flex items-start gap-3 group border-l-2 border-l-foreground/20 pl-3 -ml-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60">
                        <span>{sigType}</span>
                        <span>·</span>
                        <span className="tabular-nums">{Math.round(m.salience * 100)}%</span>
                        <span>·</span>
                        <span>{formatTime(m.created_at)}</span>
                        {validated && <><span>·</span><span className="text-foreground/70">validated</span></>}
                      </div>
                      <p className="text-sm text-foreground/90 leading-snug mt-1">{m.headline}</p>
                      {m.suggested_direction && (
                        <p className="text-xs text-muted-foreground/80 leading-relaxed mt-1">{m.suggested_direction}</p>
                      )}
                      {stone && (
                        <p className="text-[10px] text-muted-foreground/50 mt-1.5">triaged by {stone}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 opacity-70 group-hover:opacity-100 transition-opacity">
                        {!validated && (
                          <button type="button" onClick={() => respond(m.id, "validate")} className="text-xs text-muted-foreground/80 hover:text-foreground underline-offset-4 hover:underline">
                            Validate
                          </button>
                        )}
                        {(sigType === "task" || sigType === "reminder") && (
                          <button type="button" onClick={() => respond(m.id, "start_task")} className="text-xs text-muted-foreground/80 hover:text-foreground underline-offset-4 hover:underline">
                            Start as task
                          </button>
                        )}
                        {sigType === "message" && (
                          <button type="button" onClick={() => respond(m.id, "start_message")} className="text-xs text-muted-foreground/80 hover:text-foreground underline-offset-4 hover:underline">
                            Draft message
                          </button>
                        )}
                        <button type="button" onClick={() => respond(m.id, "complete")} className="text-xs text-muted-foreground/80 hover:text-foreground underline-offset-4 hover:underline">
                          Complete
                        </button>
                        <button type="button" onClick={() => respond(m.id, "dismissed")} className="text-xs text-muted-foreground/60 hover:text-foreground underline-offset-4 hover:underline">
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {digestMoments.length > 0 && (
        <div className="px-6 mt-10">
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

      {/* Floating "+" — capture anything; server routes to person/event/reminder. */}
      <FloatingCapture />
    </div>
  );
}
