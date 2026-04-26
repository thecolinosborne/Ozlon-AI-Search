import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type CognitiveMode = "focus" | "idle" | "planning" | "reactive";

/**
 * Phase F — read-only companion to `useContextMode`.
 *
 * Subscribes to the current cognitive mode from `user_context_state` and
 * keeps it in sync via a polling refresh + realtime channel. Presentation
 * surfaces (e.g. ModeRibbon) consume this to gently adapt density / tone.
 */
export function useCurrentMode(): {
  mode: CognitiveMode;
  cognitiveLoad: number;
  loading: boolean;
} {
  const { user } = useAuth();
  const [mode, setMode] = useState<CognitiveMode>("planning");
  const [cognitiveLoad, setCognitiveLoad] = useState(0.3);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const fetchMode = async () => {
      const { data } = await supabase
        .from("user_context_state")
        .select("current_mode, cognitive_load_estimate")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setMode((data.current_mode as CognitiveMode) ?? "planning");
        setCognitiveLoad(Number(data.cognitive_load_estimate ?? 0.3));
      }
      setLoading(false);
    };

    fetchMode();
    const interval = window.setInterval(fetchMode, 25_000);

    const channel = supabase
      .channel(`mode:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_context_state",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as {
            current_mode?: CognitiveMode;
            cognitive_load_estimate?: number;
          } | null;
          if (!row) return;
          if (row.current_mode) setMode(row.current_mode);
          if (typeof row.cognitive_load_estimate === "number") {
            setCognitiveLoad(row.cognitive_load_estimate);
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [user]);

  return { mode, cognitiveLoad, loading };
}
