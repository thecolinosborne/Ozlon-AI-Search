import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Phase D — Context Mode Tracker.
 *
 * Heuristically infers the user's current cognitive mode and writes it to
 * `user_context_state` so signals can respect focus / idle / planning / reactive.
 *
 * Heuristics (lightweight, additive only):
 *   - `focus`     : actively typing/streaming in chat for >60s of activity
 *   - `reactive`  : just arrived from a signal deep-link (?signal=…)
 *   - `planning`  : on a planning surface (Signals, Communications, Wisdom)
 *   - `idle`      : no input, no streaming, tab hidden or 5min quiet
 *
 * Writes are debounced to once per 30s per mode change. No business logic
 * lives here — this is presentation/awareness only.
 */
export function useContextMode(opts: {
  isStreaming: boolean;
  hasInput: boolean;
  routePath: string;
  arrivedFromSignal: boolean;
}) {
  const { user } = useAuth();
  const lastModeRef = useRef<string | null>(null);
  const lastWriteRef = useRef(0);
  const lastActivityRef = useRef(Date.now());

  // Track raw activity
  useEffect(() => {
    if (opts.hasInput || opts.isStreaming) {
      lastActivityRef.current = Date.now();
    }
  }, [opts.hasInput, opts.isStreaming]);

  useEffect(() => {
    if (!user) return;

    const tick = () => {
      let mode: "focus" | "idle" | "planning" | "reactive" = "idle";
      const quietMs = Date.now() - lastActivityRef.current;
      const hidden = typeof document !== "undefined" && document.hidden;

      if (opts.arrivedFromSignal) mode = "reactive";
      else if (opts.isStreaming || (opts.hasInput && quietMs < 60_000)) mode = "focus";
      else if (/^\/(signals|communications|wisdom)/.test(opts.routePath)) mode = "planning";
      else if (hidden || quietMs > 5 * 60_000) mode = "idle";
      else mode = "reactive";

      const now = Date.now();
      if (mode === lastModeRef.current && now - lastWriteRef.current < 30_000) return;
      lastModeRef.current = mode;
      lastWriteRef.current = now;

      // Fire and forget; do not block UI on errors.
      supabase
        .from("user_context_state")
        .upsert(
          { user_id: user.id, current_mode: mode, last_activity_at: new Date().toISOString() },
          { onConflict: "user_id" }
        )
        .then(() => {});
    };

    tick();
    const interval = window.setInterval(tick, 20_000);
    return () => window.clearInterval(interval);
  }, [user, opts.isStreaming, opts.hasInput, opts.routePath, opts.arrivedFromSignal]);
}
