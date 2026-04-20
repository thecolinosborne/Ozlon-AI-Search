import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type StoneCapability = {
  provider: string;
  defaultModel: string;
  reasoning: number;
  vision: number;
  image: number;
  video?: number;
  speed: number;
  cost: number;
  maxCtx: number;
  keyTail?: string | null;
  source?: "user" | "system" | "none";
};

export type ProviderRow = {
  id: string;
  user_id: string;
  provider: string;
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
  modality: string | null;
  complexity: string | null;
  reason: string | null;
  fallback_used: boolean;
  latency_ms: number | null;
  success: boolean;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

export type UserKeyStatus = {
  id: string;
  connected: boolean;
  last4?: string | null;
  nickname?: string | null;
  console_url?: string;
  key_prefix?: string;
  label?: string;
};

// All stones surfaced in the Brain UI. Lovable is the platform default.
export const ALL_STONES = ["lovable", "openai", "gemini", "higgsfield", "anthropic", "xai", "deepseek", "mistral"] as const;

// Which stones the system has env keys for (verified server-side)
const SYSTEM_VERIFIED = ["lovable", "openai", "gemini", "higgsfield"];

export type GauntletMode = "speed" | "balanced" | "quality";
const MODE_KEY = "ozlon.gauntlet.mode";

function readMode(): GauntletMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === "speed" || v === "balanced" || v === "quality") return v;
  } catch { /* ignore */ }
  return "balanced";
}

export function useGauntlet() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [stones, setStones] = useState<Record<string, StoneCapability>>({});
  const [recentDecisions, setRecentDecisions] = useState<RoutingLogEntry[]>([]);
  const [userKeys, setUserKeys] = useState<Record<string, UserKeyStatus>>({});
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [mode, setModeState] = useState<GauntletMode>(() => readMode());

  const setMode = useCallback((m: GauntletMode) => {
    setModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const auth = session ? { Authorization: `Bearer ${session.access_token}` } : {};

      const [{ data: gauntlet }, { data: brain }, { data: decisions }] = await Promise.all([
        supabase.functions.invoke("gauntlet-router", {
          body: { action: "list" },
          headers: auth,
        }),
        supabase.functions.invoke("connect-brain", {
          body: { action: "list_status" },
          headers: auth,
        }),
        supabase.functions.invoke("gauntlet-router", {
          body: { action: "recent_decisions", limit: 20 },
          headers: auth,
        }),
      ]);

      if (gauntlet) {
        setProviders(gauntlet.providers ?? []);
        setStones(gauntlet.stones ?? {});
      }

      const map: Record<string, UserKeyStatus> = {};
      for (const p of (brain?.platforms ?? []) as Array<UserKeyStatus & { id: string }>) {
        map[p.id] = p;
      }
      setUserKeys(map);
      setRecentDecisions((decisions?.decisions ?? []) as RoutingLogEntry[]);
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

  useEffect(() => { refresh(); }, [refresh]);

  const usage = ALL_STONES.map((stone) => {
    const count = recentDecisions.filter((l) => l.chosen_stone === stone).length;
    return {
      stone,
      count,
      pct: recentDecisions.length > 0 ? Math.round((count / recentDecisions.length) * 100) : 0,
    };
  });

  const keysDetected =
    providers.filter((p) => p.status === "active").length +
    Object.values(userKeys).filter((u) => u.connected).length;

  return {
    providers, stones, logs: recentDecisions, recentDecisions, usage, userKeys,
    loading, verifying, refresh, verifyAll,
    mode, setMode,
    ALL_STONES, SYSTEM_VERIFIED, keysDetected,
  };
}
