import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useSignals, type SignalMoment } from "@/hooks/useSignals";

interface Props {
  variant?: "page" | "indicator" | "inline";
  maxMoments?: number;
}

const BreathingDot = ({ active }: { active: boolean }) => (
  <span
    className={cn(
      "inline-block w-1.5 h-1.5 rounded-full bg-foreground/50",
      active && "animate-pulse"
    )}
    aria-hidden
  />
);

const InlinePrompt = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="text-sm text-muted-foreground/70 hover:text-foreground transition-colors underline-offset-4 hover:underline"
  >
    {children}
  </button>
);

export function SignalSurface({ variant = "page", maxMoments = 1 }: Props) {
  const { moments, topMoment, loading, synthesizing, respond } = useSignals();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<{ why: boolean; what: boolean }>({ why: false, what: false });

  const handleAct = (m: SignalMoment) => {
    const intent = m.suggested_direction || m.headline;
    respond(m.id, "acted");
    navigate(`/?intent=${encodeURIComponent(intent)}&signal=${m.id}`);
  };

  // Indicator variant: small dot in nav
  if (variant === "indicator") {
    return (
      <div className="flex items-center gap-1.5" title={topMoment?.headline ?? "Quiet"}>
        <BreathingDot active={moments.length > 0} />
        {moments.length > 0 && (
          <span className="text-xs text-muted-foreground">{moments.length}</span>
        )}
      </div>
    );
  }

  // Page variant: full minimalist surface
  const visible = moments.slice(0, maxMoments);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      <div className="max-w-2xl w-full">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-4 text-center">
            <BreathingDot active={!loading && !synthesizing} />
            <p className="text-base text-muted-foreground/70 font-light">
              {synthesizing ? "Listening…" : loading ? "" : "Nothing needs you right now."}
            </p>
          </div>
        ) : (
          <div className="space-y-12">
            {visible.map((m) => (
              <div key={m.id} className="space-y-6 animate-in fade-in duration-700">
                <div className="flex items-center gap-2">
                  <BreathingDot active />
                </div>
                <h2 className="text-3xl sm:text-4xl font-light tracking-tight text-foreground leading-snug">
                  {m.headline}
                </h2>

                {expanded.why && m.reason && (
                  <p className="text-base text-muted-foreground leading-relaxed animate-in fade-in slide-in-from-top-1 duration-500">
                    {m.reason}
                  </p>
                )}
                {expanded.what && m.suggested_direction && (
                  <p className="text-base text-foreground/80 leading-relaxed animate-in fade-in slide-in-from-top-1 duration-500">
                    {m.suggested_direction}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-2">
                  {m.reason && !expanded.why && (
                    <InlinePrompt onClick={() => setExpanded((e) => ({ ...e, why: true }))}>
                      Why?
                    </InlinePrompt>
                  )}
                  {m.suggested_direction && !expanded.what && (
                    <InlinePrompt onClick={() => setExpanded((e) => ({ ...e, what: true }))}>
                      What should I do?
                    </InlinePrompt>
                  )}
                  <InlinePrompt onClick={() => handleAct(m)}>Handle it</InlinePrompt>
                  <InlinePrompt onClick={() => respond(m.id, "dismissed")}>Not now</InlinePrompt>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
