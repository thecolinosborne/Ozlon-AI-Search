import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface NowLine {
  text: string;
  tone: string;
  source: string | null;
  updated_at: string;
}

export interface LifePerson {
  id: string;
  name: string;
  relationship: string | null;
  birthday: string | null;
  notes: string | null;
  last_contact_at: string | null;
}

export interface LifeEvent {
  id: string;
  person_id: string | null;
  kind: string;
  title: string;
  notes: string | null;
  next_due_at: string | null;
  last_done_at: string | null;
  recurrence_days: number | null;
  desired_duration_minutes: number | null;
  status: string;
}

/**
 * Stage 1 of the Today layer. Read-only surface that hydrates:
 *  - the live one-line narration (now_line_state)
 *  - the next few life events (birthdays, care, follow-ups)
 *  - the people-in-your-life list (for context only)
 *
 * Realtime-subscribes to now_line_state so the line breathes as the day moves.
 */
export function useTodayLayer() {
  const { user, session } = useAuth();
  const [nowLine, setNowLine] = useState<NowLine | null>(null);
  const [people, setPeople] = useState<LifePerson[]>([]);
  const [events, setEvents] = useState<LifeEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [narrating, setNarrating] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [nowRes, peopleRes, eventsRes] = await Promise.all([
      supabase
        .from("now_line_state")
        .select("text, tone, source, updated_at")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("life_people")
        .select("id, name, relationship, birthday, notes, last_contact_at")
        .eq("user_id", user.id)
        .order("name"),
      supabase
        .from("life_events")
        .select("id, person_id, kind, title, notes, next_due_at, last_done_at, recurrence_days, desired_duration_minutes, status")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("next_due_at", { ascending: true, nullsFirst: false })
        .limit(20),
    ]);
    setNowLine((nowRes.data as NowLine | null) ?? null);
    setPeople((peopleRes.data ?? []) as LifePerson[]);
    setEvents((eventsRes.data ?? []) as LifeEvent[]);
    setLoading(false);
  }, [user]);

  // Ask the server to refresh the one-line narration now.
  const narrate = useCallback(async () => {
    if (!session || narrating) return;
    setNarrating(true);
    try {
      await supabase.functions.invoke("signals-narrate", { body: {} });
    } finally {
      setNarrating(false);
    }
  }, [session, narrating]);

  // Capture anything: reminder, person, event, task — server routes it.
  const capture = useCallback(
    async (text: string) => {
      if (!session || !text.trim()) return { ok: false as const };
      const { data, error } = await supabase.functions.invoke("signals-capture", {
        body: { text },
      });
      if (!error) await load();
      return { ok: !error, data, error };
    },
    [session, load],
  );

  useEffect(() => {
    if (!user) {
      setNowLine(null);
      setPeople([]);
      setEvents([]);
      return;
    }
    void load();

    // Realtime: now_line_state changes drive the breathing line.
    const ch = supabase
      .channel(`now_line_${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "now_line_state", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = (payload.new as NowLine | undefined) ?? null;
          if (row) setNowLine(row);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [user, load]);

  return { nowLine, people, events, loading, narrating, narrate, capture, reload: load };
}
