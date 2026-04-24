import { useEffect, useMemo, useRef, useState } from "react";
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
import { FocusStack } from "@/components/communications/FocusStack";
import { SummaryChip } from "@/components/communications/SummaryChip";
import { OutboxBadge } from "@/components/communications/OutboxBadge";
import { useIsMobile } from "@/hooks/use-mobile";
import { UnifiedStream } from "@/components/communications/UnifiedStream";
import { FilterDropdown, type FilterValue } from "@/components/communications/FilterDropdown";
import { ChannelChips, type ChipFilter } from "@/components/communications/ChannelChips";
import { ReplySheet } from "@/components/communications/ReplySheet";
import { BriefMeOverlay } from "@/components/communications/BriefMeOverlay";
import { EmptyCaughtUp } from "@/components/communications/EmptyCaughtUp";
import { SlackStatusBanner } from "@/components/communications/SlackStatusBanner";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useCommReadState } from "@/hooks/useCommReadState";
import { cn } from "@/lib/utils";

function greetingFor(name?: string | null) {
  const h = new Date().getHours();
  const period = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const who = name?.split(" ")[0] ?? "friend";
  return `Good ${period}, ${who}.`;
}

export default function Communications() {
  const { user } = useAuth();
  const { digest, stream, diagnostics, isFetching, refetch } = useCommunicationsFeed();
  const isMobile = useIsMobile();
  const { ref, collapsed } = useScrollCollapse(80);
  const brief = useDailyBrief();
  const readState = useCommReadState();

  const [chip, setChip] = useState<ChipFilter>("all");
  const [stateFilter, setStateFilter] = useState<FilterValue>("all");
  const [active, setActive] = useState<CommMessage | null>(null);
  const [activeDraft, setActiveDraft] = useState<string | undefined>(undefined);
  const [triage, setTriage] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const prevSlackMissing = useRef(false);

  // Toast once when Slack flips from missing-scope → loading messages.
  useEffect(() => {
    const slackCount = diagnostics.sources.slack ?? 0;
    const wasMissing = prevSlackMissing.current;
    const isMissingNow = diagnostics.slackReason === "missing_scope" && slackCount === 0;
    if (wasMissing && !isMissingNow && slackCount > 0) {
      toast({ title: "Slack connected", description: "Scanning DMs…" });
    }
    prevSlackMissing.current = isMissingNow;
  }, [diagnostics.sources.slack, diagnostics.slackReason]);

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

  // Smart summary counts — derived from already-loaded data, no extra fetch.
  const summaryCounts = useMemo(() => {
    const visible = stream.filter((m) => !hidden.has(m.id));
    return {
      total: visible.length,
      unread: visible.filter((m) => m.isUnread).length,
      needsReply: visible.filter((m) => m.needsReply).length,
    };
  }, [stream, hidden]);

  const openMessage = (m: CommMessage) => {
    setActiveDraft(undefined);
    setActive(m);
  };

  const openPriority = (p: PriorityItem) => {
    const match = stream.find((m) => m.id === p.id);
    if (match) {
      setActiveDraft(undefined);
      setActive(match);
    }
  };

  // Action chip handlers from priority cards (AI triage hints).
  const handlePriorityReply = (p: PriorityItem) => {
    const match = stream.find((m) => m.id === p.id);
    if (!match) {
      toast({ title: "Message not in current view", description: "Try Scan to refresh." });
      return;
    }
    setActiveDraft(p.suggestedReply);
    setActive(match);
  };
  const handlePrioritySnooze = (p: PriorityItem) => {
    setHidden((s) => new Set(s).add(p.id));
    readState.snooze(p.id, Date.now() + 60 * 60 * 1000);
    toast({ title: "Snoozed for 1 hour" });
  };
  const handlePriorityDone = (p: PriorityItem) => {
    setHidden((s) => new Set(s).add(p.id));
    readState.markDone(p.id);
    toast({ title: "Marked done" });
  };

  const handleDone = (m: CommMessage) => {
    setHidden((s) => new Set(s).add(m.id));
    readState.markDone(m.id);
  };
  const handleSnooze = (m: CommMessage) => {
    setHidden((s) => new Set(s).add(m.id));
    // Default snooze: 1 hour
    readState.snooze(m.id, Date.now() + 60 * 60 * 1000);
  };
  const handleDeleted = (m: CommMessage) => {
    setHidden((s) => new Set(s).add(m.id));
    readState.softDelete(m.id);
  };
  const handleRowDelete = async (m: CommMessage) => {
    setHidden((s) => new Set(s).add(m.id));
    readState.softDelete(m.id);
    try {
      if (m.source === "gmail") {
        const id = m.id.replace(/^gmail:/, "");
        await supabase.functions.invoke("google-gmail", {
          body: { action: "trash_message", params: { id } },
        });
        toast({
          title: "Moved to trash",
          action: (
            <button
              onClick={async () => {
                await supabase.functions.invoke("google-gmail", {
                  body: { action: "untrash_message", params: { id } },
                });
                setHidden((s) => {
                  const n = new Set(s);
                  n.delete(m.id);
                  return n;
                });
                toast({ title: "Restored" });
              }}
              className="text-xs font-medium text-primary hover:underline"
            >
              Undo
            </button>
          ),
        });
      } else if (m.source === "slack") {
        const parts = m.id.split(":");
        const channel = parts[1];
        const ts = parts.slice(2).join(":");
        const { data, error } = await supabase.functions.invoke("slack", {
          body: { action: "delete_message", params: { channel, ts } },
        });
        const ok = !error && (data as { success?: boolean })?.success !== false;
        if (!ok) {
          setHidden((s) => {
            const n = new Set(s);
            n.delete(m.id);
            return n;
          });
          toast({
            title: "Can't delete",
            description: "Slack only allows deleting messages you posted.",
            variant: "destructive",
          });
        } else {
          toast({ title: "Deleted from Slack" });
        }
      } else if (m.source === "ghl") {
        const conversationId = m.threadId || m.id.replace(/^ghl:/, "");
        await supabase.functions.invoke("gohighlevel", {
          body: { action: "update_conversation", params: { conversationId, read: true } },
        });
        toast({ title: "Marked as read" });
      }
    } catch (e) {
      setHidden((s) => {
        const n = new Set(s);
        n.delete(m.id);
        return n;
      });
      toast({
        title: "Action failed",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
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
        <div className="lg:grid lg:grid-cols-[32%_68%] lg:gap-0">
          {/* Left / hero — desktop only thin "Today" rail; mobile gets nothing here */}
          {!isMobile && (
            <aside className="lg:sticky lg:top-14 lg:self-start lg:max-h-[calc(100vh-3.5rem)] lg:overflow-y-auto">
              <HeroDigest
                digest={digest}
                collapsed={collapsed}
                greeting={greeting}
                onBrief={() => brief.play(digest.briefScript)}
              />
            </aside>
          )}

          {/* Right / unified stream */}
          <section>
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

            {diagnostics.partial && diagnostics.sources.slack === 0 ? (
              <SlackStatusBanner
                reason={diagnostics.slackReason}
                scope={diagnostics.slackScope ?? null}
              />
            ) : null}

            {/* Focus Stack — top 3 AI-ranked priorities with inline actions */}
            <FocusStack
              priorities={digest.priorities}
              onTap={openPriority}
              onReply={handlePriorityReply}
              onSnooze={handlePrioritySnooze}
              onDone={handlePriorityDone}
            />

            {/* Smart summary chip — toggles "needs reply" filter */}
            <SummaryChip
              unread={summaryCounts.unread}
              needsReply={summaryCounts.needsReply}
              total={summaryCounts.total}
              active={stateFilter === "needs-reply"}
              onToggle={() =>
                setStateFilter((v) => (v === "needs-reply" ? "all" : "needs-reply"))
              }
            />

            {filtered.length === 0 ? (
              <EmptyCaughtUp />
            ) : (
              <>
                {digest.priorities.length > 0 && (
                  <div className="px-4 lg:px-6 pt-3 pb-1">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/50">
                      Everything else
                    </span>
                  </div>
                )}
                <UnifiedStream
                  messages={filtered}
                  onTap={openMessage}
                  onDone={handleDone}
                  onSnooze={handleSnooze}
                  onDelete={handleRowDelete}
                />
                <OutboxBadge onRetry={() => refetch()} />
              </>
            )}
          </section>
        </div>
      </div>

      <ReplySheet
        message={active}
        initialDraft={activeDraft}
        onClose={() => {
          setActiveDraft(undefined);
          closeReply();
        }}
        onDeleted={handleDeleted}
      />
      <BriefMeOverlay
        open={brief.isOverlayOpen}
        isPlaying={brief.isPlaying}
        script={digest.briefScript}
        onClose={brief.close}
      />
    </div>
  );
}
