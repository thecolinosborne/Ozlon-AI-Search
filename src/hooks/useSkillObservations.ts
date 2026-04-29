import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * useSkillObservations — Phase 1 visibility for the meta-skill loop.
 *
 * Reads the user's skill-observation reflection notes (silent capture from the
 * `skill-observer` edge function) and active cross-cutting principles. No
 * mutations exposed yet beyond deactivating a principle — that's the
 * mandatory revocability for the prompt-injection mitigation.
 */
export function useSkillObservations() {
  const { user } = useAuth();
  const [observationCount, setObservationCount] = useState(0);
  const [recent, setRecent] = useState<
    Array<{ id: string; title: string; kind: string; createdAt: string; importance: number }>
  >([]);
  const [principles, setPrinciples] = useState<
    Array<{ id: string; title: string; principle: string; active: boolean; createdAt: string }>
  >([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setObservationCount(0);
      setRecent([]);
      setPrinciples([]);
      return;
    }
    setLoading(true);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

    const [countRes, recentRes, principlesRes] = await Promise.all([
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
      // cross_cutting_principles is post-migration; types may lag for one cycle.
      // Cast the builder to avoid blocking the UI on stale generated types.
      (supabase.from as unknown as (t: string) => ReturnType<typeof supabase.from>)(
        "cross_cutting_principles",
      )
        .select("id, title, principle, active, created_at")
        .eq("user_id", user.id)
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
    setPrinciples(
      ((principlesRes.data ?? []) as Array<{
        id: string;
        title: string;
        principle: string;
        active: boolean;
        created_at: string;
      }>).map((p) => ({
        id: p.id,
        title: p.title,
        principle: p.principle,
        active: p.active,
        createdAt: p.created_at,
      })),
    );
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const deactivatePrinciple = useCallback(
    async (id: string) => {
      await (supabase.from as unknown as (t: string) => ReturnType<typeof supabase.from>)(
        "cross_cutting_principles",
      )
        .update({ active: false })
        .eq("id", id);
      await load();
    },
    [load],
  );

  return {
    observationCount,
    recent,
    principles,
    loading,
    refresh: load,
    deactivatePrinciple,
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
