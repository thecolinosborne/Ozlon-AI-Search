import { Plane, ExternalLink } from "lucide-react";
import type { Flight } from "./types";
import { PriceTrendBadge, Sparkline } from "./PriceTrendBadge";
import { TrustChips } from "./TrustChips";

export const FlightRow = ({ flight, onTap }: { flight: Flight; onTap?: () => void }) => {
  const h = Math.floor(flight.duration_min / 60);
  const m = flight.duration_min % 60;
  return (
    <button
      type="button"
      onClick={onTap}
      className="w-full text-left p-3 rounded-xl bg-card/70 hover:bg-card border border-border/40 transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-muted/70 flex items-center justify-center text-xs font-semibold text-foreground/80 shrink-0">
          {flight.airline_code}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm font-medium truncate">
              {flight.airline} <span className="text-muted-foreground font-normal">· {flight.flight_number}</span>
            </div>
            <div className="text-base font-semibold tabular-nums">${flight.price_usd}</div>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground tabular-nums">
            <span>{flight.depart_time}</span>
            <Plane className="w-3 h-3" />
            <span>{flight.arrive_time}</span>
            <span>· {h}h {m}m</span>
            <span>· {flight.stops === 0 ? "nonstop" : `${flight.stops} stop`}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <TrustChips chips={[
              ...(flight.refundable ? [{ label: "Refundable", tone: "good" as const }] : []),
              ...(flight.carry_on_included ? [{ label: "Bag incl.", tone: "good" as const }] : []),
            ]} />
            <div className="flex items-center gap-2">
              <Sparkline points={flight.sparkline} trend={flight.trend} />
              <PriceTrendBadge current={flight.price_usd} baseline={flight.baseline_usd} trend={flight.trend} />
            </div>
          </div>
        </div>
      </div>
    </button>
  );
};
