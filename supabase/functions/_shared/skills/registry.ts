// Skill registry — loads installed skills for a user and produces a
// compact 1-line index (so 100+ skills don't bloat the prompt).
// Full instructions are only loaded on-demand via the `load_skill` tool.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SkillRow, SkillIndexEntry, SkillManifest } from "./types.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Fetch all enabled installs for a user, joined with skill manifest. */
export async function getInstalledSkills(userId: string): Promise<SkillRow[]> {
  const sb = admin();
  const { data, error } = await sb
    .from("skill_installs")
    .select("skill:skills(*)")
    .eq("user_id", userId)
    .eq("enabled", true);

  if (error) {
    console.error("[skills] getInstalledSkills error:", error);
    return [];
  }
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((r: any) => r.skill).filter(Boolean) as SkillRow[];
}

/** Compact one-line entries the AI can scan cheaply. */
export function buildSkillIndex(skills: SkillRow[]): SkillIndexEntry[] {
  return skills.map((s) => ({
    slug: s.slug,
    name: s.name,
    description: s.description,
  }));
}

/** Format index entries into a system-prompt block. Returns "" if empty. */
export function formatSkillIndexForPrompt(entries: SkillIndexEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map((e) => `- ${e.slug}: ${e.description || e.name}`);
  return [
    "Installed skills (call load_skill(slug) to activate one):",
    ...lines,
  ].join("\n");
}

/** Look up a skill by slug for a given user (must be installed + enabled). */
export async function getSkillBySlug(
  userId: string,
  slug: string,
): Promise<SkillRow | null> {
  const sb = admin();
  const { data, error } = await sb
    .from("skill_installs")
    .select("skill:skills(*)")
    .eq("user_id", userId)
    .eq("enabled", true)
    .limit(50);
  if (error || !data) return null;
  // deno-lint-ignore no-explicit-any
  const row = (data as any[]).find((r) => r.skill?.slug === slug);
  return (row?.skill ?? null) as SkillRow | null;
}

/** Record an invocation in the audit log. */
export async function recordInvocation(params: {
  userId: string;
  skillId: string;
  triggerType: string;
  triggerPayload?: Record<string, unknown>;
  toolsCalled?: string[];
  outcome?: "success" | "partial" | "error";
}): Promise<void> {
  const sb = admin();
  const { error } = await sb.from("skill_invocations").insert({
    user_id: params.userId,
    skill_id: params.skillId,
    trigger_type: params.triggerType,
    trigger_payload: params.triggerPayload ?? {},
    tools_called: params.toolsCalled ?? [],
    outcome: params.outcome ?? "success",
  });
  if (error) console.error("[skills] recordInvocation error:", error);
}

/** Validate a skill manifest shape. Returns list of issues (empty = valid). */
export function validateManifest(m: Partial<SkillManifest>): string[] {
  const issues: string[] = [];
  if (!m.slug || !/^[a-z0-9-]+$/.test(m.slug)) issues.push("slug must be lowercase-kebab");
  if (!m.name) issues.push("name required");
  if (!m.description) issues.push("description required");
  if (!m.version) issues.push("version required");
  if (!Array.isArray(m.triggers) || m.triggers.length === 0) issues.push("at least one trigger required");
  if (!Array.isArray(m.tools_required)) issues.push("tools_required must be an array");
  if (!m.instructions || m.instructions.length < 20) issues.push("instructions must be substantive (>=20 chars)");
  return issues;
}
