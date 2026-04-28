import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Sparkles, Link2, BookOpen, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { SignalMoment } from "@/hooks/useSignals";

interface Props {
  moment: SignalMoment | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAct?: (m: SignalMoment) => void;
  onSnooze?: (m: SignalMoment) => void;
  onDismiss?: (m: SignalMoment) => void;
  onMarkWrong?: (m: SignalMoment) => void;
}

interface MemoryRow {
  id: string;
  memory_type: string;
  summary: string | null;
  content: string;
  salience: number;
}

const formatTime = (iso: string) => {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 60000;
  if (diff < 1) return "just now";
  if (diff < 60) return `${Math.round(diff)}m ago`;
  if (diff < 1440) return `${Math.round(diff / 60)}h ago`;
  return `${Math.round(diff / 1440)}d ago`;
};

const formatLookahead = (iso: string | null) => {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h left`;
  return `${Math.round(hrs / 24)}d left`;
};

export function SignalDetailSheet({
  moment,
  open,
  onOpenChange,
  onAct,
  onSnooze,
  onDismiss,
  onMarkWrong,
}: Props) {
  const { user } = useAuth();
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);

  useEffect(() => {
    if (!open || !moment || !user) {
      setMemories([]);
      return;
    }
    const ids = Array.isArray(moment.wisdom_memory_ids)
      ? (moment.wisdom_memory_ids as string[])
      : [];
    if (ids.length === 0) return;
    setMemoriesLoading(true);
    (async () => {
      const { data } = await supabase
        .from("wisdom_memories")
        .select("id, memory_type, summary, content, salience")
        .in("id", ids)
        .eq("user_id", user.id)
        .limit(20);
      setMemories(((data ?? []) as unknown) as MemoryRow[]);
      setMemoriesLoading(false);
    })();
  }, [open, moment, user]);

  if (!moment) return null;

  const sources = Array.isArray(moment.source_refs) ? (moment.source_refs as Array<Record<string, unknown>>) : [];
  const lookahead = formatLookahead(moment.expires_at ?? null);
  const isUrgent = moment.salience >= 0.85;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto bg-background/95 backdrop-blur-2xl border-l border-border/60"
      >
        <SheetHeader className="text-left">
          <div className="flex items-center gap-2 mb-1">
            <div
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center",
                isUrgent ? "bg-amber-500/15 text-amber-300" : "bg-primary/12 text-primary",
              )}
            >
              <Sparkles className="w-3 h-3" />
            </div>
            <span
              className={cn(
                "text-[10px] uppercase tracking-[0.18em] font-medium",
                isUrgent ? "text-amber-300/80" : "text-primary/80",
              )}
            >
              {isUrgent ? "Signal · urgent" : "Signal"}
            </span>
            <span className="text-[10px] text-muted-foreground/60 tabular-nums">
              {moment.kind}
            </span>
          </div>
          <SheetTitle className="text-xl font-light leading-snug text-foreground">
            {moment.headline}
          </SheetTitle>
        </SheetHeader>

        {/* Meta strip */}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground/70">
          <span className="tabular-nums">salience {Math.round(moment.salience * 100)}%</span>
          <span className="tabular-nums">confidence {Math.round(moment.confidence * 100)}%</span>
          <span>mode · {moment.mode_context}</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatTime(moment.created_at)}
          </span>
          {lookahead && <span>{lookahead}</span>}
        </div>

        {/* Reason — full, no clamp */}
        {moment.reason && (
          <section className="mt-6">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 mb-2">
              Why this surfaced
            </p>
            <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">
              {moment.reason}
            </p>
          </section>
        )}

        {/* Suggested direction — full */}
        {moment.suggested_direction && (
          <section className="mt-6">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 mb-2">
              Suggested direction
            </p>
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
              {moment.suggested_direction}
            </p>
          </section>
        )}

        {/* Evidence / source refs */}
        {sources.length > 0 && (
          <section className="mt-6">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 mb-2 inline-flex items-center gap-1.5">
              <Link2 className="w-3 h-3" /> Evidence
            </p>
            <ul className="space-y-1.5">
              {sources.map((s, i) => {
                const label =
                  (s.title as string) ||
                  (s.subject as string) ||
                  (s.name as string) ||
                  (s.kind as string) ||
                  `Source ${i + 1}`;
                const detail = (s.id as string) || (s.url as string) || "";
                return (
                  <li
                    key={i}
                    className="text-xs text-muted-foreground/80 leading-snug border-l border-border/50 pl-2.5"
                  >
                    <span className="text-foreground/80">{label}</span>
                    {detail && (
                      <span className="ml-2 text-muted-foreground/50 font-mono text-[10px]">
                        {detail}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Linked wisdom memories */}
        {(memories.length > 0 || memoriesLoading) && (
          <section className="mt-6">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 mb-2 inline-flex items-center gap-1.5">
              <BookOpen className="w-3 h-3" /> Drawn from memory
            </p>
            {memoriesLoading ? (
              <p className="text-xs text-muted-foreground/60">Loading…</p>
            ) : (
              <ul className="space-y-2">
                {memories.map((m) => (
                  <li key={m.id} className="text-xs leading-snug">
                    <div className="flex items-center gap-2 text-muted-foreground/60 mb-0.5">
                      <span>{m.memory_type}</span>
                      <span className="tabular-nums">{Math.round(m.salience * 100)}%</span>
                    </div>
                    <p className="text-foreground/80">{m.summary || m.content.slice(0, 200)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Actions */}
        <div className="mt-8 flex flex-wrap gap-2 pb-4">
          <button
            onClick={() => {
              onAct?.(moment);
              onOpenChange(false);
            }}
            className="h-8 px-3 rounded-full bg-foreground text-background text-xs font-medium hover:bg-foreground/90 transition-colors"
          >
            Handle it
          </button>
          <button
            onClick={() => {
              onSnooze?.(moment);
              onOpenChange(false);
            }}
            className="h-8 px-3 rounded-full bg-muted/40 text-foreground/80 text-xs hover:bg-muted/60 transition-colors"
          >
            Snooze
          </button>
          <button
            onClick={() => {
              onDismiss?.(moment);
              onOpenChange(false);
            }}
            className="h-8 px-3 rounded-full bg-muted/40 text-foreground/80 text-xs hover:bg-muted/60 transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={() => {
              onMarkWrong?.(moment);
              onOpenChange(false);
            }}
            className="h-8 px-3 rounded-full text-muted-foreground/70 text-xs hover:text-foreground transition-colors ml-auto"
          >
            Mark wrong
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
