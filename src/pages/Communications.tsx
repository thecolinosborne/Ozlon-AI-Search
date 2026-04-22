import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Mic } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useCommunicationsFeed, type CommMessage } from "@/hooks/useCommunicationsFeed";
import { useScrollCollapse } from "@/hooks/useScrollCollapse";
import { useDailyBrief } from "@/hooks/useDailyBrief";
import { HeroDigest } from "@/components/communications/HeroDigest";
import { UnifiedStream } from "@/components/communications/UnifiedStream";
import { FilterDropdown, type FilterValue } from "@/components/communications/FilterDropdown";
import { ReplySheet } from "@/components/communications/ReplySheet";
import { BriefMeOverlay } from "@/components/communications/BriefMeOverlay";
import { EmptyCaughtUp } from "@/components/communications/EmptyCaughtUp";

function greetingFor(name?: string | null) {
  const h = new Date().getHours();
  const period = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const who = name?.split(" ")[0] ?? "friend";
  return `Good ${period}, ${who}.`;
}

export default function Communications() {
  const { user } = useAuth();
  const { digest, stream } = useCommunicationsFeed();
  const { ref, collapsed } = useScrollCollapse(80);
  const brief = useDailyBrief();

  const [filter, setFilter] = useState<FilterValue>("all");
  const [active, setActive] = useState<CommMessage | null>(null);

  const greeting = greetingFor((user?.user_metadata as { full_name?: string })?.full_name ?? user?.email);

  const filtered = useMemo(() => {
    switch (filter) {
      case "all":
        return stream;
      case "unread":
        return stream.filter((m) => m.isUnread);
      case "needs-reply":
        return stream.filter((m) => m.needsReply);
      default:
        return stream.filter((m) => m.channel === filter);
    }
  }, [stream, filter]);

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
        <button
          className="w-9 h-9 rounded-full bg-card/60 backdrop-blur-xl border border-border/30 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Voice command"
        >
          <Mic className="w-4 h-4" />
        </button>
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
            />
          </aside>

          {/* Right / unified stream */}
          <section>
            {/* Soft gradient divider */}
            <div className="h-6 bg-gradient-to-b from-transparent to-background lg:hidden" />

            {/* Sticky sub-header */}
            <div className="sticky top-14 z-20 px-4 lg:px-6 py-2.5 flex items-center justify-between bg-background/70 backdrop-blur-2xl">
              <h2 className="text-[13px] font-medium text-foreground">All Messages</h2>
              <FilterDropdown value={filter} onChange={setFilter} />
            </div>

            {filtered.length === 0 ? (
              <EmptyCaughtUp />
            ) : (
              <UnifiedStream messages={filtered} onTap={setActive} />
            )}
          </section>
        </div>
      </div>

      <ReplySheet message={active} onClose={() => setActive(null)} />
      <BriefMeOverlay
        open={brief.isOverlayOpen}
        isPlaying={brief.isPlaying}
        script={digest.briefScript}
        onClose={brief.close}
      />
    </div>
  );
}
