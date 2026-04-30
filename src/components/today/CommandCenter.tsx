import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CardShell } from "./CardShell";
import { WhyThisSheet } from "./WhyThisSheet";
import { CardDetailSheet } from "./CardDetailSheet";
import { useTodayLayer, type LifeEvent, type LifePerson } from "@/hooks/useTodayLayer";
import type { BriefCard, CardKey, DailyBrief } from "@/hooks/useDailyBriefing";

interface CommandCenterProps {
  brief: DailyBrief | null;
  loading?: boolean;
}

/**
 * The 8-card calm grid: Today's Plan · Late · Up Next · People Waiting · Habits ·
 * Goals · Watch · Won Today.
 *
 * Each card uses the AI brief for value/ai_line/action; tap opens a detail sheet
 * with the underlying list (sourced from useTodayLayer).
 */
export function CommandCenter({ brief, loading }: CommandCenterProps) {
  const navigate = useNavigate();
  const { events, people } = useTodayLayer();
  const [openCard, setOpenCard] = useState<CardKey | null>(null);
  const [whyCard, setWhyCard] = useState<CardKey | null>(null);

  // Slice the underlying data once per render for the detail sheets.
  const slices = useMemo(() => sliceData(events, people), [events, people]);

  const cards = brief?.cards;

  const order: { key: CardKey; label: string }[] = [
    { key: "plan",      label: "Today's Plan" },
    { key: "late",      label: "Late" },
    { key: "up_next",   label: "Up Next" },
    { key: "people",    label: "People Waiting" },
    { key: "habits",    label: "Habits" },
    { key: "goals",     label: "Goals" },
    { key: "watch",     label: "Watch" },
    { key: "won_today", label: "Won Today" },
  ];

  const doNow = (card: BriefCard | undefined, fallback: string) => {
    const intent = card?.do_now_intent || fallback;
    navigate(`/?intent=${encodeURIComponent(intent)}`);
  };

  return (
    <div className="px-6 pb-10">
      <div className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {order.map(({ key, label }) => {
            const c = cards?.[key];
            const clear = !c || c.value?.toLowerCase() === "clear";
            return (
              <CardShell
                key={key}
                label={label}
                value={c?.value ?? (loading ? "…" : "Clear")}
                aiLine={c?.ai_line ?? (loading ? "" : "Nothing here right now.")}
                actionLabel={c?.action_label ?? "Open"}
                signalStrength={c?.signal_strength ?? "low"}
                clear={clear}
                onAction={() => doNow(c, defaultIntent(key, label))}
                onAskWhy={() => setWhyCard(key)}
                onOpen={() => setOpenCard(key)}
              />
            );
          })}
        </div>
      </div>

      {/* Detail sheets per card */}
      <CardDetailSheet
        open={openCard === "plan"}
        onClose={() => setOpenCard(null)}
        title="Today's Plan"
        aiLine={cards?.plan?.ai_line}
      >
        <EventList items={slices.todayDue} emptyLabel="Nothing planned for today." />
      </CardDetailSheet>

      <CardDetailSheet
        open={openCard === "late"}
        onClose={() => setOpenCard(null)}
        title="Late"
        aiLine={cards?.late?.ai_line}
      >
        <EventList items={slices.overdue} emptyLabel="Nothing late. You're current." />
      </CardDetailSheet>

      <CardDetailSheet
        open={openCard === "up_next"}
        onClose={() => setOpenCard(null)}
        title="Up Next"
        aiLine={cards?.up_next?.ai_line}
      >
        <EventList items={slices.upcoming} emptyLabel="Nothing else on the calendar today." />
      </CardDetailSheet>

      <CardDetailSheet
        open={openCard === "people"}
        onClose={() => setOpenCard(null)}
        title="People Waiting"
        aiLine={cards?.people?.ai_line}
      >
        <PeopleList items={slices.peopleStale} emptyLabel="No one is waiting on you." />
      </CardDetailSheet>

      <CardDetailSheet
        open={openCard === "habits"}
        onClose={() => setOpenCard(null)}
        title="Habits"
        aiLine={cards?.habits?.ai_line}
      >
        <EventList items={slices.habits} emptyLabel="No habits set yet." />
      </CardDetailSheet>

      <CardDetailSheet
        open={openCard === "goals"}
        onClose={() => setOpenCard(null)}
        title="Goals"
        aiLine={cards?.goals?.ai_line}
      >
        <p className="text-xs text-muted-foreground/70 leading-relaxed">
          Add a goal from the "+" button. Try "Goal: ship Q4 launch by Dec 1".
        </p>
      </CardDetailSheet>

      <CardDetailSheet
        open={openCard === "watch"}
        onClose={() => setOpenCard(null)}
        title="Watch"
        aiLine={cards?.watch?.ai_line}
      >
        <p className="text-xs text-muted-foreground/70 leading-relaxed">
          Risks and stalled work surface here once detected.
        </p>
      </CardDetailSheet>

      <CardDetailSheet
        open={openCard === "won_today"}
        onClose={() => setOpenCard(null)}
        title="Won Today"
        aiLine={cards?.won_today?.ai_line}
      >
        <EventList items={slices.doneToday} emptyLabel="Nothing finished yet today." />
      </CardDetailSheet>

      {/* Why this? per card */}
      {whyCard && (
        <WhyThisSheet
          open
          onClose={() => setWhyCard(null)}
          title={order.find((o) => o.key === whyCard)?.label ?? "Why this?"}
          why={cards?.[whyCard]?.why_this ?? null}
        />
      )}
    </div>
  );
}

function defaultIntent(key: CardKey, label: string): string {
  switch (key) {
    case "plan":      return "Start a focus block on my next task.";
    case "late":      return "Help me clear my overdue items, fastest first.";
    case "up_next":   return "Prepare me for my next calendar event.";
    case "people":    return "Help me draft a reply to the most time-sensitive person.";
    case "habits":    return "Start my easiest habit for today.";
    case "goals":     return "What's the next concrete step on my top goal?";
    case "watch":     return "Walk me through my risks and create a recovery action.";
    case "won_today": return "Recap what I finished today.";
    default:          return label;
  }
}

function sliceData(events: LifeEvent[], people: LifePerson[]) {
  const now = new Date();
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);

  const todayDue = events.filter((e) => {
    if (!e.next_due_at) return false;
    const t = new Date(e.next_due_at).getTime();
    return t >= startOfDay.getTime() && t <= endOfDay.getTime();
  });
  const overdue = events.filter((e) => {
    if (!e.next_due_at) return false;
    return new Date(e.next_due_at).getTime() < startOfDay.getTime();
  });
  const upcoming = events.filter((e) => {
    if (!e.next_due_at) return false;
    const t = new Date(e.next_due_at).getTime();
    return t > now.getTime() && t <= endOfDay.getTime();
  }).slice(0, 6);
  const habits = events.filter((e) => !!e.recurrence_days).slice(0, 6);
  const doneToday = events.filter((e) => {
    if (!e.last_done_at) return false;
    return new Date(e.last_done_at).getTime() >= startOfDay.getTime();
  });
  const peopleStale = [...people]
    .sort((a, b) => {
      const at = a.last_contact_at ? new Date(a.last_contact_at).getTime() : 0;
      const bt = b.last_contact_at ? new Date(b.last_contact_at).getTime() : 0;
      return at - bt;
    })
    .slice(0, 6);

  return { todayDue, overdue, upcoming, habits, doneToday, peopleStale };
}

function EventList({ items, emptyLabel }: { items: LifeEvent[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground/60">{emptyLabel}</p>;
  }
  return (
    <ul className="divide-y divide-border/30">
      {items.map((e) => (
        <li key={e.id} className="py-2 flex items-start gap-2">
          <span className="mt-1.5 inline-block w-1 h-1 rounded-full bg-foreground/40 shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground/90 leading-snug">{e.title}</p>
            {e.next_due_at && (
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">{relative(e.next_due_at)}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PeopleList({ items, emptyLabel }: { items: LifePerson[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground/60">{emptyLabel}</p>;
  }
  return (
    <ul className="divide-y divide-border/30">
      {items.map((p) => (
        <li key={p.id} className="py-2 flex items-start gap-2">
          <span className="mt-1.5 inline-block w-1 h-1 rounded-full bg-foreground/40 shrink-0" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground/90 leading-snug">{p.name}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">
              {p.last_contact_at ? `Last heard ${relative(p.last_contact_at)}` : "No contact yet"}
              {p.relationship ? ` · ${p.relationship}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function relative(iso: string): string {
  const d = new Date(iso).getTime() - Date.now();
  const mins = Math.round(d / 60000);
  if (mins < -1440) return `${Math.round(-mins / 1440)}d ago`;
  if (mins < -60) return `${Math.round(-mins / 60)}h ago`;
  if (mins < 0) return "just now";
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  return `in ${Math.round(days / 7)}w`;
}
