import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface SignalMoment {
  id: string;
  kind: string;
  headline: string;
  reason: string | null;
  suggested_direction: string | null;
  salience: number;
  confidence: number;
  mode_context: string;
  status: string;
  created_at: string;
}

export type SignalOutcome = "acted" | "ignored" | "dismissed";

export function useSignals() {
  const { user, session } = useAuth();
  const [moments, setMoments] = useState<SignalMoment[]>([]);
  const [loading, setLoading] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const lastSynthRef = useRef(0);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("signal_moments")
      .select("id, kind, headline, reason, suggested_direction, salience, confidence, mode_context, status, created_at")
      .eq("user_id", user.id)
      .eq("status", "live")
      .order("salience", { ascending: false })
      .limit(3);
    setMoments((data ?? []) as SignalMoment[]);
    setLoading(false);
  }, [user]);

  const synthesize = useCallback(async () => {
    if (!session || synthesizing) return;
    if (Date.now() - lastSynthRef.current < 60_000) return; // client throttle
    lastSynthRef.current = Date.now();
    setSynthesizing(true);
    try {
      const { error } = await supabase.functions.invoke("signals-synthesize", { body: {} });
      if (error) {
        // Edge runtime hiccups (503/timeout) must NEVER bubble — Signals is best-effort.
        console.warn("[useSignals] synthesize skipped:", error.message ?? error);
      }
      await load();
    } catch (e) {
      console.warn("[useSignals] synthesize threw (swallowed):", e);
    } finally {
      setSynthesizing(false);
    }
  }, [session, synthesizing, load]);

  const respond = useCallback(async (signalId: string, outcome: SignalOutcome, note?: string) => {
    setMoments((prev) => prev.filter((m) => m.id !== signalId));
    await supabase.functions.invoke("signals-feedback", {
      body: { signal_id: signalId, outcome, outcome_note: note ?? null },
    });
  }, []);

  // Initial load + on-mount synthesize
  useEffect(() => {
    if (!user) return;
    load().catch((e) => console.warn("[useSignals] load failed:", e));
    synthesize().catch((e) => console.warn("[useSignals] synthesize failed:", e));
  }, [user, load, synthesize]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`signals:${user.id}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "signal_moments",
        filter: `user_id=eq.${user.id}`,
      }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, load]);

  return { moments, topMoment: moments[0] ?? null, loading, synthesizing, synthesize, respond };
}
