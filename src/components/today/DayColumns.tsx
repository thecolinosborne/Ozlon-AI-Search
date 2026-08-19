import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  Eye,
  MapPin,
  Users,
  Video,
  ExternalLink,
  Mail,
} from "lucide-react";
import type {
  CalendarEvent,
  SignalStrength,
  TodoItem,
  WatchOut,
} from "@/hooks/useDailyBriefing";

interface Props {
  events?: CalendarEvent[];
  connected?: boolean;
  todos?: TodoItem[];
  watchouts?: WatchOut[];
  emailScanned?: number;
  loading?: boolean;
}

type Bucket = "now" | "next" | "later" | "tomorrow";

const BUCKET_LABELS: Record<Bucket, string> = {
  now: "Happening now",
  next: "Up next",
  later: "Later today",
  tomorrow: "Tomorrow",
};

function fmtTime(iso: string | null, allDay: boolean) {
  if (!iso) return "";
  if (allDay) return "All day";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function bucketOf(e: CalendarEvent, now: Date): Bucket | null {
  if (!e.start) return null;
  const s = new Date(e.start);
  const en = e.end ? new Date(e.end) : new Date(s.getTime() + 30 * 60_000);
  if (s <= now && en >= now) return "now";
  if (!isSameDay(s, now)) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return isSameDay(s, tomorrow) ? "tomorrow" : null;
  }
  return s.getTime() - now.getTime() <= 90 * 60_000 ? "next" : "later";
}

function strengthDot(s: SignalStrength) {
  switch (s) {
    case "critical":
      return "bg-destructive animate-pulse";
    case "high":
      return "bg-foreground/70";
    case "medium":
      return "bg-foreground/40";
    default:
      return "bg-foreground/20";
  }
}

/**
 * Command-center day view: Schedule · To-Do · Watch Out, side by side.
 * All three read from the same AI brief (calendar + email scan).
 */
export function DayColumns({ events, connected, todos, watchouts, emailScanned, loading }: Props) {
  const navigate = useNavigate();
  const now = new Date();

  const grouped = useMemo(() => {
    const g: Record<Bucket, CalendarEvent[]> = { now: [], next: [], later: [], tomorrow: [] };
    (events ?? []).forEach((e) => {
      const b = bucketOf(e, now);
      if (b) g[b].push(e);
    });
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  const totalToday = grouped.now.length + grouped.next.length + grouped.later.length;
  const scheduleEmpty = totalToday === 0 && grouped.tomorrow.length === 0;

  const go = (intent?: string, fallback?: string) => {
    const q = intent || fallback;
    if (!q) return;
    navigate(`/?intent=${encodeURIComponent(q)}`);
  };

  return (
    <div className="px-6 pt-2 pb-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Schedule */}
        <Column
          icon={<CalendarIcon className="w-4 h-4 text-foreground/70" />}
          title="Schedule"
          subtitle={
            loading
              ? "Syncing…"
              : !connected
                ? "Not connected"
                : scheduleEmpty
                  ? "Nothing on the books"
                  : `${totalToday} today${grouped.tomorrow.length ? ` · ${grouped.tomorrow.length} tomorrow` : ""}`
          }
          action={
            <Link
              to="/integrations/google-calendar"
              className="text-[11px] text-muted-foreground/70 hover:text-foreground inline-flex items-center gap-1 transition-colors"
            >
              {connected ? "Manage" : "Connect"}
              <ExternalLink className="w-3 h-3" />
            </Link>
          }
        >
          {!connected && !loading && (
            <Empty text="Connect Google Calendar to see your meetings here." />
          )}
          {connected && scheduleEmpty && !loading && (
            <Empty text="Clear through tomorrow. A good window for deep work." />
          )}
          {connected && !scheduleEmpty && (
            <div className="space-y-4">
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
        </Column>

        {/* To-Do */}
        <Column
          icon={<CheckCircle2 className="w-4 h-4 text-foreground/70" />}
          title="To-Do"
          subtitle={
            loading
              ? "Thinking…"
              : (todos?.length ?? 0) === 0
                ? "Clear"
                : `${todos?.length} for today`
          }
        >
          {!loading && (todos?.length ?? 0) === 0 && (
            <Empty text="Nothing needs you right now." />
          )}
          <ul className="space-y-1">
            {(todos ?? []).map((t, i) => (
              <li
                key={`${t.title}-${i}`}
                className="group px-3 py-2.5 rounded-xl border border-transparent hover:border-border/40 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-start gap-2.5">
                  <span className={`mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full ${strengthDot(t.urgency)}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground/90 leading-snug">{t.title}</p>
                    {t.detail && (
                      <p className="text-[11px] text-muted-foreground/70 leading-relaxed mt-0.5">{t.detail}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground/55">
                      <span>{t.source}</span>
                      {t.est_minutes ? <span>{t.est_minutes} min</span> : null}
                      <button
                        type="button"
                        onClick={() => go(t.do_now_intent, t.title)}
                        className="ml-auto normal-case tracking-normal text-[11px] text-muted-foreground/70 hover:text-foreground underline-offset-4 hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Do it now
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Column>

        {/* Watch Out */}
        <Column
          icon={<Eye className="w-4 h-4 text-foreground/70" />}
          title="Watch Out"
          subtitle={
            loading
              ? "Scanning…"
              : (watchouts?.length ?? 0) === 0
                ? "Clear"
                : `${watchouts?.length} to keep an eye on`
          }
          action={
            emailScanned ? (
              <span className="text-[11px] text-muted-foreground/60 inline-flex items-center gap-1">
                <Mail className="w-3 h-3" />
                {emailScanned} scanned
              </span>
            ) : null
          }
        >
          {!loading && (watchouts?.length ?? 0) === 0 && (
            <Empty text="Nothing drifting. Calendar and inbox look clean." />
          )}
          <ul className="space-y-1">
            {(watchouts ?? []).map((w, i) => (
              <li
                key={`${w.title}-${i}`}
                className="group px-3 py-2.5 rounded-xl border border-transparent hover:border-border/40 hover:bg-muted/20 transition-colors"
              >
                <div className="flex items-start gap-2.5">
                  <span className={`mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full ${strengthDot(w.severity)}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground/90 leading-snug">{w.title}</p>
                    {w.detail && (
                      <p className="text-[11px] text-muted-foreground/70 leading-relaxed mt-0.5">{w.detail}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground/55">
                      <span>{w.source}</span>
                      <button
                        type="button"
                        onClick={() => go(w.do_now_intent, w.title)}
                        className="ml-auto normal-case tracking-normal text-[11px] text-muted-foreground/70 hover:text-foreground underline-offset-4 hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Handle
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Column>
      </div>
    </div>
  );
}

function Column({
  icon,
  title,
  subtitle,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/40 bg-gradient-to-b from-muted/20 to-background/40 backdrop-blur-sm p-5 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-foreground/5 border border-border/40 flex items-center justify-center">
            {icon}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground/90 leading-none">{title}</p>
            <p className="text-[11px] text-muted-foreground/70 mt-1">{subtitle}</p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground/70 leading-relaxed">{text}</p>;
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
      <div className="shrink-0 w-14 pt-0.5">
        <p className="text-xs font-medium tabular-nums text-foreground/80">
          {fmtTime(event.start, event.all_day)}
        </p>
        {event.end && !event.all_day && (
          <p className="text-[10px] text-muted-foreground/60 tabular-nums">{fmtTime(event.end, false)}</p>
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
            <span className="inline-flex items-center gap-1 truncate max-w-[160px]">
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
