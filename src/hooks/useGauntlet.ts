import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type StoneCapability = {
  provider: string;
  defaultModel: string;
  reasoning: number;
  vision: number;
  image: number;
  speed: number;
  cost: number;
  maxCtx: number;
};

export type ProviderRow = {
  id: string;
  user_id: string;
  provider: "lovable" | "openai" | "gemini" | "anthropic";
  status: "active" | "disabled" | "error";
  priority: number;
  capabilities: StoneCapability;
  mode: "auto" | "manual";
  last_verified_at: string | null;
  last_error: string | null;
};

export type RoutingLogEntry = {
  id: string;
  chosen_stone: string;
  chosen_model: string | null;
  reason: string | null;
  fallback_used: boolean;
  latency_ms: number | null;
  success: boolean;
  created_at: string;
};

const ALL_STONES = ["lovable", "openai", "gemini", "anthropic"] as const;

export function useGauntlet() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [stones, setStones] = useState<Record<string, StoneCapability>>({});
  const [logs, setLogs] = useState<RoutingLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("gauntlet-router", {
        body: { action: "list" },
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!error && data) {
        setProviders(data.providers ?? []);
        setStones(data.stones ?? {});
      }

      // Fetch recent routing log
      const { data: logData } = await supabase
        .from("gauntlet_routing_log")
        .select("id, chosen_stone, chosen_model, reason, fallback_used, latency_ms, success, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      setLogs(logData ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  const verifyAll = useCallback(async () => {
    setVerifying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await supabase.functions.invoke("gauntlet-router", {
        body: { action: "verify" },
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      await refresh();
    } finally {
      setVerifying(false);
    }
  }, [refresh]);

  const setMode = useCallback(async (provider: string, mode: "auto" | "manual") => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("ai_providers").upsert(
      { user_id: user.id, provider, mode } as any,
      { onConflict: "user_id,provider" }
    );
    await refresh();
  }, [refresh]);

  const toggleStatus = useCallback(async (provider: string, status: "active" | "disabled") => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("ai_providers").upsert(
      { user_id: user.id, provider, status } as any,
      { onConflict: "user_id,provider" }
    );
    await refresh();
  }, [refresh]);

  useEffect(() => { refresh(); }, [refresh]);

  // Compute usage breakdown from logs
  const usage = ALL_STONES.map((stone) => {
    const count = logs.filter((l) => l.chosen_stone === stone).length;
    return { stone, count, pct: logs.length > 0 ? Math.round((count / logs.length) * 100) : 0 };
  });

  return { providers, stones, logs, usage, loading, verifying, refresh, verifyAll, setMode, toggleStatus, ALL_STONES };
}
