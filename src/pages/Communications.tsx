import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Mic, RefreshCw, Target } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCommunicationsFeed,
  type CommMessage,
  type CommChannel,
  type PriorityItem,
} from "@/hooks/useCommunicationsFeed";
import { useScrollCollapse } from "@/hooks/useScrollCollapse";
import { useDailyBrief } from "@/hooks/useDailyBrief";
import { HeroDigest } from "@/components/communications/HeroDigest";
import { UnifiedStream } from "@/components/communications/UnifiedStream";
import { FilterDropdown, type FilterValue } from "@/components/communications/FilterDropdown";
import { ChannelChips, type ChipFilter } from "@/components/communications/ChannelChips";
import { ReplySheet } from "@/components/communications/ReplySheet";
import { BriefMeOverlay } from "@/components/communications/BriefMeOverlay";
import { EmptyCaughtUp } from "@/components/communications/EmptyCaughtUp";
import { cn } from "@/lib/utils";

function greetingFor(name?: string | null) {
  const h = new Date().getHours();
  const period = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const who = name?.split(" ")[0] ?? "friend";
  return `Good ${period}, ${who}.`;
}

export default function Communications() {
  const { user } = useAuth();
  const { digest, stream, isFetching, refetch } = useCommunicationsFeed();
  const { ref, collapsed } = useScrollCollapse(80);
  const brief = useDailyBrief();

  const [chip, setChip] = useState<ChipFilter>("all");
  const [stateFilter, setStateFilter] = useState<FilterValue>("all");
  const [active, setActive] = useState<CommMessage | null>(null);
  const [triage, setTriage] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const greeting = greetingFor(
    (user?.user_metadata as { full_name?: string })?.full_name ?? user?.email,
  );

  // Counts per channel for chip badges (from full stream, ignoring filters)
  const channelCounts = useMemo(() => {
    const c: Record<CommChannel, number> = { email: 0, slack: 0, sms: 0, voicemail: 0 };
    for (const m of stream) c[m.channel] += 1;
    return c;
  }, [stream]);

  // Apply chip + state + triage + hidden, in order.
  const filtered = useMemo(() => {
    let out = stream.filter((m) => !hidden.has(m.id));
    if (triage) out = out.filter((m) => m.needsReply);
    if (chip !== "all") out = out.filter((m) => m.channel === chip);
    if (stateFilter === "unread") out = out.filter((m) => m.isUnread);
    if (stateFilter === "needs-reply") out = out.filter((m) => m.needsReply);
    return out;
  }, [stream, hidden, triage, chip, stateFilter]);

  const openMessage = (m: CommMessage) => setActive(m);

  const openPriority = (p: PriorityItem) => {
    const match = stream.find((m) => m.id === p.id);
    if (match) setActive(match);
  };

  const handleDone = (m: CommMessage) => {
    setHidden((s) => new Set(s).add(m.id));
  };
  const handleSnooze = (m: CommMessage) => {
    setHidden((s) => new Set(s).add(m.id));
  };
  const handleDeleted = (m: CommMessage) => {
    setHidden((s) => new Set(s).add(m.id));
  };

  const closeReply = () => {
    if (triage && active) {
      // Auto-advance to next needsReply, hide the one we just handled.
      const remaining = stream.filter(
        (m) => !hidden.has(m.id) && m.id !== active.id && m.needsReply,
      );
      setHidden((s) => new Set(s).add(active.id));
      setActive(remaining[0] ?? null);
    } else {
      setActive(null);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-40 h-14 px-3 flex items-center justify-between bg-background/70 backdrop-blur-2xl border-b border-border/20 safe-area-top">
        <Link
          to="/"
          className="flex items-center gap-2 px-2 py-1.5 rounded-full text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Communications</span>
        </Link>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-9 px-3 rounded-full bg-card/60 backdrop-blur-xl border border-border/30 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
            aria-label="Scan for new messages"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
            <span>{isFetching ? "Scanning" : "Scan"}</span>
          </button>
          <button
            className="w-9 h-9 rounded-full bg-card/60 backdrop-blur-xl border border-border/30 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Voice command"
          >
            <Mic className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Scrollable surface */}
      <div ref={ref} className="flex-1 overflow-y-auto">
        <div className="lg:grid lg:grid-cols-[38%_62%] lg:gap-0">
          {/* Left / hero */}
          <aside className="lg:sticky lg:top-14 lg:self-start lg:max-h-[calc(100vh-3.5rem)] lg:overflow-y-auto">
            <HeroDigest
              digest={digest}
              collapsed={collapsed}
              greeting={greeting}
              onBrief={() => brief.play(digest.briefScript)}
              onPriorityTap={openPriority}
            />
          </aside>

          {/* Right / unified stream */}
          <section>
            {/* Soft gradient divider */}
            <div className="h-6 bg-gradient-to-b from-transparent to-background lg:hidden" />

            {/* Sticky sub-header */}
            <div className="sticky top-14 z-20 px-4 lg:px-6 py-2.5 bg-background/70 backdrop-blur-2xl space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[13px] font-medium text-foreground">All Messages</h2>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setTriage((v) => !v)}
                    className={cn(
                      "inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-medium border transition-colors",
                      triage
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card/40 text-muted-foreground hover:text-foreground border-border/30",
                    )}
                    aria-pressed={triage}
                    aria-label="Toggle triage mode"
                  >
                    <Target className="w-3 h-3" />
                    Triage
                  </button>
                  <FilterDropdown value={stateFilter} onChange={setStateFilter} />
                </div>
              </div>
              <ChannelChips
                value={chip}
                onChange={setChip}
                counts={channelCounts}
                total={stream.filter((m) => !hidden.has(m.id)).length}
              />
            </div>

            {filtered.length === 0 ? (
              <EmptyCaughtUp />
            ) : (
              <UnifiedStream
                messages={filtered}
                onTap={openMessage}
                onDone={handleDone}
                onSnooze={handleSnooze}
                onDelete={handleDeleted}
              />
            )}
          </section>
        </div>
      </div>

      <ReplySheet message={active} onClose={closeReply} onDeleted={handleDeleted} />
      <BriefMeOverlay
        open={brief.isOverlayOpen}
        isPlaying={brief.isPlaying}
        script={digest.briefScript}
        onClose={brief.close}
      />
    </div>
  );
}
