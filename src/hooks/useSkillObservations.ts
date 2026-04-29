import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * useSkillObservations — Phase 1 + 2 surface for the meta-skill loop.
 *
 * Phase 1: silent capture visibility (observations + principles read).
 * Phase 2: manual curation — create / edit / activate / deactivate / delete
 * cross-cutting principles. All mutations require the user to be signed in
 * and are gated by RLS (auth.uid() = user_id).
 */
export type Principle = {
  id: string;
  title: string;
  principle: string;
  active: boolean;
  createdAt: string;
};

export type Proposal = {
  id: string;
  title: string;
  principle: string;
  rationale: string | null;
  observationCount: number;
  confidence: number;
  status: "pending" | "approved" | "rejected" | "superseded";
  createdAt: string;
};

export function useSkillObservations() {
  const { user } = useAuth();
  const [observationCount, setObservationCount] = useState(0);
  const [recent, setRecent] = useState<
    Array<{ id: string; title: string; kind: string; createdAt: string; importance: number }>
  >([]);
  const [principles, setPrinciples] = useState<Principle[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setObservationCount(0);
      setRecent([]);
      setPrinciples([]);
      setProposals([]);
      return;
    }
    setLoading(true);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

    const [countRes, recentRes, principlesRes, proposalsRes] = await Promise.all([
      supabase
        .from("reflection_notes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("note_type", "skill_observation")
        .gte("created_at", sevenDaysAgo),
      supabase
        .from("reflection_notes")
        .select("id, content, importance, created_at, metadata")
        .eq("user_id", user.id)
        .eq("note_type", "skill_observation")
        .order("created_at", { ascending: false })
        .limit(8),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("cross_cutting_principles")
        .select("id, title, principle, active, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("proposed_principles")
        .select("id, title, principle, rationale, observation_count, confidence, status, created_at")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);

    setObservationCount(countRes.count ?? 0);
    setRecent(
      (recentRes.data ?? []).map((r) => {
        const meta = (r.metadata ?? {}) as { kind?: string; title?: string };
        const titleFromMeta = meta.title;
        const fallback = (r.content ?? "").split("\n")[0]?.slice(0, 100) ?? "";
        return {
          id: r.id,
          title: titleFromMeta || fallback,
          kind: meta.kind ?? "observation",
          createdAt: r.created_at,
          importance: r.importance ?? 0.5,
        };
      }),
    );
    type PrincipleRow = {
      id: string;
      title: string;
      principle: string;
      active: boolean;
      created_at: string;
    };
    const principleRows: PrincipleRow[] = Array.isArray(principlesRes.data)
      ? (principlesRes.data as unknown as PrincipleRow[])
      : [];
    setPrinciples(
      principleRows.map((p) => ({
        id: p.id,
        title: p.title,
        principle: p.principle,
        active: p.active,
        createdAt: p.created_at,
      })),
    );
    type ProposalRow = {
      id: string;
      title: string;
      principle: string;
      rationale: string | null;
      observation_count: number;
      confidence: number;
      status: Proposal["status"];
      created_at: string;
    };
    const proposalRows: ProposalRow[] = Array.isArray(proposalsRes.data)
      ? (proposalsRes.data as unknown as ProposalRow[])
      : [];
    setProposals(
      proposalRows.map((p) => ({
        id: p.id,
        title: p.title,
        principle: p.principle,
        rationale: p.rationale,
        observationCount: p.observation_count,
        confidence: p.confidence,
        status: p.status,
        createdAt: p.created_at,
      })),
    );
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const setPrincipleActive = useCallback(
    async (id: string, active: boolean) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("cross_cutting_principles")
        .update({ active })
        .eq("id", id);
      await load();
    },
    [load],
  );

  const deactivatePrinciple = useCallback(
    (id: string) => setPrincipleActive(id, false),
    [setPrincipleActive],
  );

  const activatePrinciple = useCallback(
    (id: string) => setPrincipleActive(id, true),
    [setPrincipleActive],
  );

  const createPrinciple = useCallback(
    async (input: { title: string; principle: string }) => {
      if (!user) return { ok: false as const, error: "Not signed in" };
      const title = input.title.trim();
      const principle = input.principle.trim();
      if (!title || !principle) {
        return { ok: false as const, error: "Title and principle are required" };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("cross_cutting_principles")
        .insert({
          user_id: user.id,
          title,
          principle,
          active: true,
          metadata: { source: "manual" },
        });
      if (error) return { ok: false as const, error: error.message };
      await load();
      return { ok: true as const };
    },
    [user, load],
  );

  const updatePrinciple = useCallback(
    async (id: string, patch: { title?: string; principle?: string }) => {
      const update: Record<string, string> = {};
      if (patch.title !== undefined) update.title = patch.title.trim();
      if (patch.principle !== undefined) update.principle = patch.principle.trim();
      if (!Object.keys(update).length) return { ok: true as const };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("cross_cutting_principles")
        .update(update)
        .eq("id", id);
      if (error) return { ok: false as const, error: error.message };
      await load();
      return { ok: true as const };
    },
    [load],
  );

  const deletePrinciple = useCallback(
    async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("cross_cutting_principles")
        .delete()
        .eq("id", id);
      if (error) return { ok: false as const, error: error.message };
      await load();
      return { ok: true as const };
    },
    [load],
  );

  // Run the reviewer: cluster fresh observations into pending proposals.
  const runReviewer = useCallback(async () => {
    if (!user) return { ok: false as const, error: "Not signed in" };
    setReviewing(true);
    try {
      const { data, error } = await supabase.functions.invoke("skill-reviewer", {
        body: {},
      });
      if (error) return { ok: false as const, error: error.message };
      await load();
      return { ok: true as const, data: data as { proposed?: number; reviewed?: number } };
    } finally {
      setReviewing(false);
    }
  }, [user, load]);

  // Approve a proposal → promote it into cross_cutting_principles (active).
  const approveProposal = useCallback(
    async (proposalId: string) => {
      if (!user) return { ok: false as const, error: "Not signed in" };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: proposal, error: loadErr } = await (supabase as any)
        .from("proposed_principles")
        .select("title, principle, source_reflection_ids")
        .eq("id", proposalId)
        .maybeSingle();
      if (loadErr || !proposal) {
        return { ok: false as const, error: loadErr?.message ?? "Proposal not found" };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: created, error: insErr } = await (supabase as any)
        .from("cross_cutting_principles")
        .insert({
          user_id: user.id,
          title: proposal.title,
          principle: proposal.principle,
          active: true,
          source_reflection_ids: proposal.source_reflection_ids ?? [],
          metadata: { source: "reviewer", proposal_id: proposalId },
        })
        .select("id")
        .maybeSingle();
      if (insErr) return { ok: false as const, error: insErr.message };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("proposed_principles")
        .update({
          status: "approved",
          decided_at: new Date().toISOString(),
          decided_principle_id: created?.id ?? null,
        })
        .eq("id", proposalId);
      await load();
      return { ok: true as const };
    },
    [user, load],
  );

  const rejectProposal = useCallback(
    async (proposalId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("proposed_principles")
        .update({ status: "rejected", decided_at: new Date().toISOString() })
        .eq("id", proposalId);
      if (error) return { ok: false as const, error: error.message };
      await load();
      return { ok: true as const };
    },
    [load],
  );

  return {
    observationCount,
    recent,
    principles,
    proposals,
    loading,
    reviewing,
    refresh: load,
    deactivatePrinciple,
    activatePrinciple,
    createPrinciple,
    updatePrinciple,
    deletePrinciple,
    runReviewer,
    approveProposal,
    rejectProposal,
  };
}

/**
 * Fire-and-forget end-of-session observation extraction. Safe to call from
 * anywhere (e.g. after the user closes a chat session, or on session unmount).
 * Failures are swallowed silently — observation capture must never block UX.
 */
export async function recordSkillObservations(input: {
  sessionId: string | null;
  messages: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }>;
  activeSkillSlugs?: string[];
}): Promise<void> {
  try {
    if (!input.messages || input.messages.length < 2) return;
    await supabase.functions.invoke("skill-observer", {
      body: {
        session_id: input.sessionId,
        messages: input.messages,
        active_skill_slugs: input.activeSkillSlugs ?? [],
      },
    });
  } catch (err) {
    // Phase 1 is silent capture. Never surface errors to the user.
    console.warn("[skill-observer] capture failed", err);
  }
}
