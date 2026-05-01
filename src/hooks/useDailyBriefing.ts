import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getDayMode, type DayMode } from "@/lib/today/dayMode";
import type { CapacityLabel } from "@/lib/today/capacity";

export type SignalStrength = "low" | "medium" | "high" | "critical";

export interface WhyThis {
  trigger?: string;
  connection?: string;
  matters_now?: string;
  if_ignored?: string;
  fastest_next?: string;
}

export interface TopOfMind {
  headline: string;
  why_now: string;
  est_minutes?: number;
  signal_strength: SignalStrength;
  do_now_intent?: string;
  why_this?: WhyThis;
}

export interface BriefCard {
  value: string;
  ai_line: string;
  action_label: string;
  do_now_intent?: string;
  signal_strength: SignalStrength;
  why_this?: WhyThis;
}

export type CardKey = "plan" | "late" | "up_next" | "people" | "habits" | "goals" | "watch" | "won_today";

export interface DailyBrief {
  now_line: string;
  capacity_label: CapacityLabel;
  day_mode: DayMode;
  top_of_mind: TopOfMind | null;
  cards: Record<CardKey, BriefCard> | null;
  calendar_events?: CalendarEvent[];
  calendar_connected?: boolean;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string | null;
  end: string | null;
  all_day: boolean;
  location: string | null;
  hangout_link: string | null;
  attendee_count: number;
  organizer_self: boolean;
  status: string | null;
}

const STALE_MS = 15 * 60_000;

/**
 * Reads a cached brief from now_line_state.metadata.brief and refreshes it
 * via the signals-brief edge function when stale or missing.
 */
export function useDailyBriefing() {
  const { user, session } = useAuth();
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    if (!session || refreshing.current) return;
    refreshing.current = true;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("signals-brief", { body: {} });
      if (fnErr) {
        setError(fnErr.message);
      } else if (data) {
        setBrief({
          now_line: data.now_line ?? "",
          capacity_label: (data.capacity_label as CapacityLabel) ?? "Steady day",
          day_mode: (data.day_mode as DayMode) ?? getDayMode(),
          top_of_mind: data.top_of_mind ?? null,
          cards: data.cards ?? null,
          calendar_events: (data.calendar_events as CalendarEvent[]) ?? [],
          calendar_connected: data.calendar_connected ?? false,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown");
    } finally {
      refreshing.current = false;
      setLoading(false);
    }
  }, [session]);

  // On mount, hydrate from cache, then refresh if stale.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("now_line_state")
        .select("text, metadata, updated_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const meta = (data?.metadata ?? {}) as Record<string, unknown>;
      const cached = meta.brief as Record<string, unknown> | undefined;
      if (cached && typeof cached === "object") {
        setBrief({
          now_line: (cached.now_line as string) ?? data?.text ?? "",
          capacity_label: (meta.capacity_label as CapacityLabel) ?? "Steady day",
          day_mode: (meta.day_mode as DayMode) ?? getDayMode(),
          top_of_mind: (cached.top_of_mind as TopOfMind) ?? null,
          cards: (cached.cards as Record<CardKey, BriefCard>) ?? null,
        });
      }
      const generatedAt = meta.generated_at ? new Date(meta.generated_at as string).getTime() : 0;
      const isStale = !cached || Date.now() - generatedAt > STALE_MS;
      if (isStale) void refresh();
    })();
    return () => { cancelled = true; };
  }, [user, refresh]);

  return { brief, loading, error, refresh };
}
