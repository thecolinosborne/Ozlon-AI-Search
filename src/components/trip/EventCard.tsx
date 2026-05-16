import type { TripEvent } from "./types";

export const EventCard = ({ event, onTap }: { event: TripEvent; onTap?: () => void }) => (
  <button
    type="button"
    onClick={onTap}
    className="flex items-center gap-3 w-full text-left p-2 rounded-xl bg-card/70 hover:bg-card border border-border/40 transition-colors"
  >
    <img src={event.photo} alt="" loading="lazy" className="w-14 h-14 rounded-lg object-cover shrink-0" />
    <div className="flex-1 min-w-0">
      <div className="text-sm font-medium truncate">{event.title}</div>
      <div className="text-[12px] text-muted-foreground">{event.when} · {event.kind}</div>
    </div>
    <div className="text-sm font-semibold tabular-nums shrink-0">${event.price_usd}</div>
  </button>
);
