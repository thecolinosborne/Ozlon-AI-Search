// Root artifact card rendered inline in chat for a trip plan.
// Fetches the saved trip_option by id and renders flights, stays, events,
// best-days, trust chips, refine chips, with detail sheets per row.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Plane, Building2, Ticket, Bookmark, Check } from "lucide-react";
import type { TripPlan, Flight, Stay, TripEvent } from "./types";
import { FlightRow } from "./FlightRow";
import { StayCard } from "./StayCard";
import { EventCard } from "./EventCard";
import { BestDaysStrip } from "./BestDaysStrip";
import { RefineChipsRow } from "./RefineChipsRow";
import { PriceTrendBadge } from "./PriceTrendBadge";
import { TripDetailSheet } from "./TripDetailSheet";

type DetailItem =
  | { kind: "flight"; data: Flight }
  | { kind: "stay"; data: Stay }
  | { kind: "event"; data: TripEvent };

export const TripPlanArtifact = ({ tripOptionId }: { tripOptionId: string }) => {
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<DetailItem | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("trip_options")
        .select("*")
        .eq("id", tripOptionId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) { setLoading(false); return; }
      setPlan({
        destination: data.destination,
        origin: data.origin,
        start_date: data.start_date,
        end_date: data.end_date,
        nights: 2,
        travelers: 1,
        vibe: null,
        total_usd: Number(data.total_usd),
        baseline_usd: Number(data.baseline_usd),
        trend: data.trend as any,
        flights: (data.flights as any) || [],
        stays: (data.stays as any) || [],
        events: (data.events as any) || [],
        best_days: (data.best_days as any) || [],
        hero_summary: data.hero_summary,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tripOptionId]);

  const handleSave = async () => {
    if (saved) return;
    setSaved(true);
    const { data: u } = await supabase.auth.getUser();
    if (u?.user) {
      await supabase.from("saved_trip_plans").insert({
        user_id: u.user.id,
        trip_option_id: tripOptionId,
        nickname: plan?.hero_summary || "Trip",
      });
    }
  };

  if (loading) {
    return (
      <div className="not-prose mt-3 rounded-2xl border border-border/40 bg-card/40 p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Pulling flights, stays, and things to do…
        </div>
      </div>
    );
  }
  if (!plan) return null;

  return (
    <div className="not-prose mt-3 rounded-2xl border border-border/40 bg-card/70 backdrop-blur-md overflow-hidden">
      {/* Hero */}
      <div className="px-4 pt-4 pb-3">
        <div className="text-[12px] text-muted-foreground uppercase tracking-wide">
          {plan.hero_summary}
        </div>
        <div className="mt-1 flex items-baseline gap-3 flex-wrap">
          <div className="text-3xl font-semibold tabular-nums">${Math.round(plan.total_usd).toLocaleString()}</div>
          <PriceTrendBadge current={plan.total_usd} baseline={plan.baseline_usd} trend={plan.trend} size="md" />
        </div>
      </div>

      {/* Best days */}
      {plan.best_days?.length > 0 && (
        <div className="px-4 pb-3">
          <div className="text-[11px] text-muted-foreground mb-1.5 uppercase tracking-wide">Best days to fly</div>
          <BestDaysStrip days={plan.best_days} />
        </div>
      )}

      {/* Flights */}
      {plan.flights.length > 0 && (
        <div className="px-4 py-3 border-t border-border/30">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-2 uppercase tracking-wide">
            <Plane className="w-3 h-3" /> Flights
          </div>
          <div className="space-y-2">
            {plan.flights.slice(0, 2).map((f) => (
              <FlightRow key={f.id} flight={f} onTap={() => setDetail({ kind: "flight", data: f })} />
            ))}
          </div>
        </div>
      )}

      {/* Stays */}
      {plan.stays.length > 0 && (
        <div className="px-4 py-3 border-t border-border/30">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-2 uppercase tracking-wide">
            <Building2 className="w-3 h-3" /> Stays
          </div>
          <div className="grid gap-2">
            {plan.stays.slice(0, 2).map((s) => (
              <StayCard key={s.id} stay={s} onTap={() => setDetail({ kind: "stay", data: s })} />
            ))}
          </div>
        </div>
      )}

      {/* Events */}
      {plan.events.length > 0 && (
        <div className="px-4 py-3 border-t border-border/30">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-2 uppercase tracking-wide">
            <Ticket className="w-3 h-3" /> This weekend
          </div>
          <div className="space-y-2">
            {plan.events.map((e) => (
              <EventCard key={e.id} event={e} onTap={() => setDetail({ kind: "event", data: e })} />
            ))}
          </div>
        </div>
      )}

      {/* Refine + Save */}
      <div className="px-4 py-3 border-t border-border/30 space-y-2.5">
        <RefineChipsRow
          chips={["Cheaper", "Nicer hotel", "+1 night", "Skip car", "Push 1 week"]}
          onPick={(c) => {
            // Future: fire refine_trip_plan edge function. For now, no-op preview.
            console.log("[trip] refine:", c);
          }}
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saved}
          className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-full bg-foreground text-background text-sm font-medium disabled:opacity-70"
        >
          {saved ? <><Check className="w-4 h-4" /> Saved · watching for drops</> : <><Bookmark className="w-4 h-4" /> Save this trip</>}
        </button>
      </div>

      <TripDetailSheet open={!!detail} onClose={() => setDetail(null)} item={detail} />
    </div>
  );
};
