import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface SignalProposal {
  id: string;
  proposal_type: string;
  title: string;
  description: string;
  status: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export interface LearningSnapshot {
  /** signal_pattern memories (what the system has internalized about your habits) */
  patterns: Array<{ id: string; summary: string; recurrence: number; updatedAt: string }>;
  /** Pending throttle proposals awaiting user decision */
  proposals: SignalProposal[];
  /** Total feedback events in last 7d (acted/ignored/dismissed combined) */
  feedbackCount: number;
  loading: boolean;
}

/**
 * useSignalLearning — Phase E visibility layer.
 *
 * Reads the Wisdom Engine's recent learning about Signals (patterns it has
 * internalized + pending proposals it wants the user to decide on) so the
 * Communications surface can show the user the loop is closing.
 */
export function useSignalLearning(): LearningSnapshot & {
  acceptProposal: (id: string) => Promise<void>;
  dismissProposal: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
} {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<Omit<LearningSnapshot, "loading">>({
    patterns: [],
    proposals: [],
    feedbackCount: 0,
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

    const [patternsRes, proposalsRes, feedbackRes] = await Promise.all([
      supabase
        .from("wisdom_memories")
        .select("id, summary, content, recurrence_count, updated_at")
        .eq("user_id", user.id)
        .eq("memory_type", "signal_pattern")
        .order("updated_at", { ascending: false })
        .limit(5),
      supabase
        .from("system_evolution_proposals")
        .select("id, proposal_type, title, description, status, created_at, metadata")
        .eq("user_id", user.id)
        .eq("proposal_type", "signal_throttle")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("reflection_notes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("note_type", "signal_feedback")
        .gte("created_at", sevenDaysAgo),
    ]);

    setSnapshot({
      patterns: (patternsRes.data ?? []).map((p) => ({
        id: p.id,
        summary: p.summary ?? p.content ?? "",
        recurrence: p.recurrence_count ?? 0,
        updatedAt: p.updated_at,
      })),
      proposals: (proposalsRes.data ?? []) as SignalProposal[],
      feedbackCount: feedbackRes.count ?? 0,
    });
    setLoading(false);
  }, [user]);

  const acceptProposal = useCallback(
    async (id: string) => {
      setSnapshot((s) => ({ ...s, proposals: s.proposals.filter((p) => p.id !== id) }));
      await supabase
        .from("system_evolution_proposals")
        .update({ status: "accepted" })
        .eq("id", id);
    },
    [],
  );

  const dismissProposal = useCallback(
    async (id: string) => {
      setSnapshot((s) => ({ ...s, proposals: s.proposals.filter((p) => p.id !== id) }));
      await supabase
        .from("system_evolution_proposals")
        .update({ status: "rejected" })
        .eq("id", id);
    },
    [],
  );

  useEffect(() => {
    if (!user) return;
    load();
  }, [user, load]);

  return { ...snapshot, loading, acceptProposal, dismissProposal, refresh: load };
}
