import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface Skill {
  id: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  manifest: Record<string, unknown>;
  source: "builtin" | "user" | "imported";
  visibility: "private" | "org" | "public";
  trust_tier: number;
  author_user_id: string | null;
}

export interface SkillWithInstall extends Skill {
  installed: boolean;
  enabled: boolean;
  install_id?: string;
}

export function useSkills() {
  const { user } = useAuth();
  const [skills, setSkills] = useState<SkillWithInstall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setSkills([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [{ data: catalog, error: catErr }, { data: installs, error: insErr }] =
        await Promise.all([
          supabase.from("skills").select("*").order("created_at", { ascending: false }),
          supabase.from("skill_installs").select("id, skill_id, enabled").eq("user_id", user.id),
        ]);
      if (catErr) throw catErr;
      if (insErr) throw insErr;

      const installMap = new Map<string, { id: string; enabled: boolean }>();
      (installs ?? []).forEach((i) =>
        installMap.set(i.skill_id, { id: i.id, enabled: i.enabled }),
      );

      const merged: SkillWithInstall[] = (catalog ?? []).map((s) => {
        const inst = installMap.get(s.id);
        return {
          ...(s as Skill),
          installed: !!inst,
          enabled: inst?.enabled ?? false,
          install_id: inst?.id,
        };
      });
      setSkills(merged);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const install = useCallback(
    async (skillId: string) => {
      if (!user) return;
      const { error } = await supabase
        .from("skill_installs")
        .insert({ user_id: user.id, skill_id: skillId, enabled: true });
      if (error) throw error;
      await load();
    },
    [user, load],
  );

  const uninstall = useCallback(
    async (installId: string) => {
      const { error } = await supabase.from("skill_installs").delete().eq("id", installId);
      if (error) throw error;
      await load();
    },
    [load],
  );

  const toggle = useCallback(
    async (installId: string, enabled: boolean) => {
      const { error } = await supabase
        .from("skill_installs")
        .update({ enabled })
        .eq("id", installId);
      if (error) throw error;
      await load();
    },
    [load],
  );

  return { skills, loading, error, refresh: load, install, uninstall, toggle };
}
