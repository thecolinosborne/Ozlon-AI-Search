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
  reason: string | null;
  fallback_used: boolean;
  latency_ms: number | null;
  success: boolean;
  created_at: string;
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

// All stones we surface in the UI. lovable is platform-default (not editable).
export const ALL_STONES = ["lovable", "openai", "gemini", "higgsfield", "anthropic", "xai", "deepseek", "mistral"] as const;

// Which stones the system has env keys for (verified server-side)
const SYSTEM_VERIFIED = ["lovable", "openai", "gemini", "higgsfield"];

export function useGauntlet() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [stones, setStones] = useState<Record<string, StoneCapability>>({});
  const [logs, setLogs] = useState<RoutingLogEntry[]>([]);
  const [userKeys, setUserKeys] = useState<Record<string, UserKeyStatus>>({});
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const auth = session ? { Authorization: `Bearer ${session.access_token}` } : {};

      const [{ data: gauntlet }, { data: brain }] = await Promise.all([
        supabase.functions.invoke("gauntlet-router", {
          body: { action: "list" },
          headers: auth,
        }),
        supabase.functions.invoke("connect-brain", {
          body: { action: "list_status" },
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

  useEffect(() => { refresh(); }, [refresh]);

  const usage = ALL_STONES.map((stone) => {
    const count = logs.filter((l) => l.chosen_stone === stone).length;
    return { stone, count, pct: logs.length > 0 ? Math.round((count / logs.length) * 100) : 0 };
  });

  const keysDetected = providers.filter((p) => p.status === "active").length + Object.values(userKeys).filter((u) => u.connected).length;

  return {
    providers, stones, logs, usage, userKeys,
    loading, verifying, refresh, verifyAll,
    ALL_STONES, SYSTEM_VERIFIED, keysDetected,
  };
}
