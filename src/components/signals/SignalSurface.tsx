import { useState, useEffect, useRef, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useSignals, type SignalMoment } from "@/hooks/useSignals";
import { useSkills } from "@/hooks/useSkills";

interface Props {
  variant?: "page" | "indicator" | "inline" | "voice";
  maxMoments?: number;
  /** When true on the page variant, render the remaining live moments as a stacked list below the hero. */
  showList?: boolean;
  /** voice variant only: function that injects an utterance into the realtime session */
  sendText?: (text: string) => void;
  /** voice variant only: only speak when this is true (e.g. session connected) */
  enabled?: boolean;
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

export function SignalSurface({ variant = "page", maxMoments = 1, showList = false, sendText, enabled = true }: Props) {
  const { moments, topMoment, loading, synthesizing, respond } = useSignals();
  const { skills } = useSkills();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<{ why: boolean; what: boolean }>({ why: false, what: false });
  const [hoverPreview, setHoverPreview] = useState(false);
  const spokenIdsRef = useRef<Set<string>>(new Set());

  // Map enabled skills to keyword triggers for matching against signal headlines.
  const enabledSkillTriggers = useMemo(() => {
    return skills
      .filter((s) => s.installed && s.enabled)
      .map((s) => {
        const triggers = (s.manifest as { triggers?: Array<{ type: string; match: string[] | string }> })?.triggers ?? [];
        const keywords = triggers
          .filter((t) => t.type === "keyword" && Array.isArray(t.match))
          .flatMap((t) => t.match as string[]);
        return { slug: s.slug, name: s.name, keywords };
      })
      .filter((s) => s.keywords.length > 0);
  }, [skills]);

  const matchSkill = (m: SignalMoment) => {
    const hay = `${m.headline} ${m.suggested_direction ?? ""}`.toLowerCase();
    return enabledSkillTriggers.find((s) => s.keywords.some((k) => hay.includes(k.toLowerCase())));
  };

  const handleAct = (m: SignalMoment) => {
    const intent = m.suggested_direction || m.headline;
    respond(m.id, "acted");
    navigate(`/?intent=${encodeURIComponent(intent)}&signal=${m.id}`);
  };

  const handleRunSkill = (m: SignalMoment, slug: string) => {
    respond(m.id, "acted");
    const intent = m.suggested_direction || m.headline;
    navigate(`/?intent=${encodeURIComponent(intent)}&skill=${slug}&signal=${m.id}`);
  };

  // Voice variant: inject the top moment into the realtime session once.
  // Renders nothing visible. Only speaks when `enabled` is true.
  useEffect(() => {
    if (variant !== "voice" || !enabled || !sendText || !topMoment) return;
    if (spokenIdsRef.current.has(topMoment.id)) return;
    if (topMoment.salience < 0.6) return; // voice bar — only meaningful moments
    spokenIdsRef.current.add(topMoment.id);
    const utter = topMoment.suggested_direction
      ? `Quiet note: ${topMoment.headline}. ${topMoment.suggested_direction}`
      : `Quiet note: ${topMoment.headline}.`;
    // Frame as system context so the assistant relays it naturally
    sendText(`[Signals layer]: ${utter} Mention this calmly only if it serves the user; otherwise hold it.`);
  }, [variant, enabled, sendText, topMoment]);

  if (variant === "voice") return null;

  // Indicator variant: breathing dot in nav, links to /signals
  if (variant === "indicator") {
    const count = moments.length;
    return (
      <div
        className="relative"
        onMouseEnter={() => setHoverPreview(true)}
        onMouseLeave={() => setHoverPreview(false)}
      >
        <Link
          to="/signals"
          aria-label={count > 0 ? `Signals: ${topMoment?.headline}` : "Signals — quiet"}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-full hover:bg-neutral-100 transition-colors"
        >
          <BreathingDot active={count > 0} />
          {count > 0 && (
            <span className="text-xs font-medium text-neutral-600">{count}</span>
          )}
        </Link>
        {hoverPreview && topMoment && (
          <div className="absolute right-0 top-full mt-2 w-72 p-3 rounded-xl bg-white shadow-lg border border-neutral-200 z-[70] animate-in fade-in slide-in-from-top-1 duration-200">
            <p className="text-sm font-medium text-neutral-900 leading-snug">
              {topMoment.headline}
            </p>
            {topMoment.reason && (
              <p className="mt-1.5 text-xs text-neutral-500 leading-relaxed line-clamp-3">
                {topMoment.reason}
              </p>
            )}
            <p className="mt-2 text-[11px] text-neutral-400">Tap to open Signals</p>
          </div>
        )}
      </div>
    );
  }

  // Inline variant: compact chip embeddable anywhere (e.g. chat composer)
  if (variant === "inline") {
    if (!topMoment) return null;
    return (
      <button
        type="button"
        onClick={() => navigate("/signals")}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-100 hover:bg-neutral-200 transition-colors text-xs text-neutral-700 max-w-full"
      >
        <BreathingDot active />
        <span className="truncate">{topMoment.headline}</span>
      </button>
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
                  {(() => {
                    const skill = matchSkill(m);
                    return skill ? (
                      <button
                        type="button"
                        onClick={() => handleRunSkill(m, skill.slug)}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-foreground text-background text-xs font-medium hover:bg-foreground/90 transition-colors"
                      >
                        Run {skill.name}
                      </button>
                    ) : null;
                  })()}
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
