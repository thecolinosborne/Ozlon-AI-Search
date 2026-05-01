import { useMemo } from "react";
import { Calendar as CalendarIcon, MapPin, Users, Video, ExternalLink } from "lucide-react";
import type { CalendarEvent } from "@/hooks/useDailyBriefing";
import { Link } from "react-router-dom";

interface Props {
  events?: CalendarEvent[];
  connected?: boolean;
  loading?: boolean;
}

type Bucket = "now" | "next" | "later" | "tomorrow";

interface Grouped {
  now: CalendarEvent[];
  next: CalendarEvent[];
  later: CalendarEvent[];
  tomorrow: CalendarEvent[];
}

function fmtTime(iso: string | null, allDay: boolean) {
  if (!iso) return "";
  if (allDay) return "All day";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function bucketOf(e: CalendarEvent, now: Date, todayEnd: Date): Bucket | null {
  if (!e.start) return null;
  const s = new Date(e.start);
  const en = e.end ? new Date(e.end) : new Date(s.getTime() + 30 * 60_000);
  if (s <= now && en >= now) return "now";
  if (!isSameDay(s, now)) {
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    if (isSameDay(s, tomorrow)) return "tomorrow";
    return null;
  }
  // same-day, future
  if (s.getTime() - now.getTime() <= 90 * 60_000) return "next";
  return "later";
}

const BUCKET_LABELS: Record<Bucket, string> = {
  now: "Happening now",
  next: "Up next",
  later: "Later today",
  tomorrow: "Tomorrow",
};

export function CalendarCard({ events, connected, loading }: Props) {
  const now = new Date();
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);

  const grouped: Grouped = useMemo(() => {
    const g: Grouped = { now: [], next: [], later: [], tomorrow: [] };
    (events ?? []).forEach((e) => {
      const b = bucketOf(e, now, todayEnd);
      if (b) g[b].push(e);
    });
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const totalToday = grouped.now.length + grouped.next.length + grouped.later.length;
  const empty = totalToday === 0 && grouped.tomorrow.length === 0;

  return (
    <div className="px-6 pt-2 pb-6">
      <div className="max-w-5xl mx-auto">
        <div className="rounded-2xl border border-border/40 bg-gradient-to-b from-muted/20 to-background/40 backdrop-blur-sm p-5 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-foreground/5 border border-border/40 flex items-center justify-center">
                <CalendarIcon className="w-4 h-4 text-foreground/70" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground/90 leading-none">Calendar</p>
                <p className="text-[11px] text-muted-foreground/70 mt-1">
                  {loading
                    ? "Syncing…"
                    : !connected
                      ? "Not connected"
                      : empty
                        ? "Nothing on the books"
                        : `${totalToday} today${grouped.tomorrow.length ? ` · ${grouped.tomorrow.length} tomorrow` : ""}`}
                </p>
              </div>
            </div>
            <Link
              to="/integrations/google-calendar"
              className="text-[11px] text-muted-foreground/70 hover:text-foreground inline-flex items-center gap-1 transition-colors"
            >
              {connected ? "Manage" : "Connect"}
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          {!connected && !loading && (
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              Connect Google Calendar to see your meetings here and let Signals factor them into your day.
            </p>
          )}

          {connected && empty && !loading && (
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              Your calendar is clear through tomorrow. A good window for deep work.
            </p>
          )}

          {connected && !empty && (
            <div className="space-y-5">
              {(["now", "next", "later", "tomorrow"] as Bucket[]).map((b) => {
                const list = grouped[b];
                if (!list.length) return null;
                return (
                  <div key={b}>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60 mb-2">
                      {BUCKET_LABELS[b]}
                    </p>
                    <ul className="space-y-1.5">
                      {list.map((e) => (
                        <EventRow key={e.id} event={e} highlight={b === "now"} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EventRow({ event, highlight }: { event: CalendarEvent; highlight?: boolean }) {
  return (
    <li
      className={`group flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
        highlight
          ? "border-foreground/30 bg-foreground/[0.03]"
          : "border-transparent hover:border-border/40 hover:bg-muted/20"
      }`}
    >
      <div className="shrink-0 w-16 pt-0.5">
        <p className="text-xs font-medium tabular-nums text-foreground/80">
          {fmtTime(event.start, event.all_day)}
        </p>
        {event.end && !event.all_day && (
          <p className="text-[10px] text-muted-foreground/60 tabular-nums">
            {fmtTime(event.end, false)}
          </p>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground/90 leading-snug truncate">{event.summary}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-muted-foreground/70">
          {event.attendee_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <Users className="w-3 h-3" />
              {event.attendee_count}
            </span>
          )}
          {event.location && (
            <span className="inline-flex items-center gap-1 truncate max-w-[200px]">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="truncate">{event.location}</span>
            </span>
          )}
          {event.hangout_link && (
            <a
              href={event.hangout_link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <Video className="w-3 h-3" />
              Join
            </a>
          )}
        </div>
      </div>
      {highlight && (
        <span className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-foreground/70 animate-pulse" aria-hidden />
      )}
    </li>
  );
}
