import { Star, MapPin } from "lucide-react";
import type { Stay } from "./types";
import { TripPhotoCarousel } from "./TripPhotoCarousel";
import { TrustChips } from "./TrustChips";
import { PriceTrendBadge } from "./PriceTrendBadge";

export const StayCard = ({ stay, onTap }: { stay: Stay; onTap?: () => void }) => (
  <div className="rounded-xl overflow-hidden bg-card/70 border border-border/40">
    <button type="button" onClick={onTap} className="block w-full text-left">
      <TripPhotoCarousel photos={stay.photos} />
    </button>
    <div className="p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{stay.name}</div>
          <div className="mt-0.5 flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-0.5">
              <Star className="w-3 h-3 fill-current text-amber-500" />
              {stay.rating.toFixed(1)}
              <span className="opacity-60">({stay.reviews})</span>
            </span>
            <span className="inline-flex items-center gap-0.5">
              <MapPin className="w-3 h-3" /> {stay.neighborhood}
            </span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-semibold tabular-nums">${stay.per_night_usd}</div>
          <div className="text-[10px] text-muted-foreground">per night</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <TrustChips chips={[
          { label: stay.kind === "hotel" ? "Hotel" : "Airbnb" },
          ...(stay.free_cancellation ? [{ label: "Free cancel", tone: "good" as const }] : []),
        ]} />
        <PriceTrendBadge current={stay.total_usd} baseline={stay.baseline_usd} trend={stay.trend} />
      </div>
    </div>
  </div>
);
