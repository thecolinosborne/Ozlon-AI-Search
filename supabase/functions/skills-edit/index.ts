// skills-edit: patch installed skills (instructions, prerequisites, manifest fields).
// - Forks builtin/imported skills into a private user copy before mutating.
// - Bumps semver patch version on every save.
// - Re-runs the Ozlon Compatibility Scan; blocks on hard failures.
// - Writes a skill_snapshots row for audit.
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runOzlonScan } from "../_shared/skills/scan.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Op =
  | { op: "append_prerequisites"; slug: string; prerequisites: string[] }
  | {
      op: "patch_instructions";
      slug: string;
      mode: "append" | "prepend" | "replace_section";
      section?: string;
      content: string;
    }
  | { op: "update_manifest"; slug: string; patch: Record<string, unknown> };

const MANIFEST_PATCH_ALLOW = new Set([
  "description",
  "triggers",
  "tools_required",
  "tools_optional",
  "memory_domains",
  "modes_allowed",
  "requires_confirmation",
  "name",
]);

function bumpPatch(version: string): string {
  const parts = version.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return "1.0.1";
  parts[2] += 1;
  return parts.join(".");
}

function appendPrerequisites(instructions: string, prereqs: string[]): string {
  const cleaned = prereqs.map((p) => p.trim()).filter(Boolean);
  if (cleaned.length === 0) return instructions;
  const header = "## Prerequisites";
  const bullets = cleaned.map((p) => `- ${p}`).join("\n");

  if (instructions.includes(header)) {
    // Merge into existing section (append bullets, dedupe verbatim).
    const lines = instructions.split("\n");
    const startIdx = lines.findIndex((l) => l.trim() === header);
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i])) {
        endIdx = i;
        break;
      }
    }
    const existing = new Set(
      lines.slice(startIdx + 1, endIdx)
        .map((l) => l.trim())
        .filter((l) => l.startsWith("- "))
    );
    const newBullets = cleaned
      .map((p) => `- ${p}`)
      .filter((b) => !existing.has(b));
    if (newBullets.length === 0) return instructions;
    const insertAt = endIdx;
    return [
      ...lines.slice(0, insertAt),
      ...newBullets,
      "",
      ...lines.slice(insertAt),
    ].join("\n").replace(/\n{3,}/g, "\n\n");
  }
  return `${header}\n${bullets}\n\n${instructions}`;
}

function patchInstructions(
  instructions: string,
  mode: "append" | "prepend" | "replace_section",
  content: string,
  section?: string,
): string {
  if (mode === "append") return `${instructions.trimEnd()}\n\n${content.trim()}\n`;
  if (mode === "prepend") return `${content.trim()}\n\n${instructions.trimStart()}`;
  // replace_section
  if (!section) return `${instructions.trimEnd()}\n\n${content.trim()}\n`;
  const header = `## ${section}`;
  if (!instructions.includes(header)) {
    return `${instructions.trimEnd()}\n\n${header}\n${content.trim()}\n`;
  }
  const lines = instructions.split("\n");
  const startIdx = lines.findIndex((l) => l.trim() === header);
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return [
    ...lines.slice(0, startIdx + 1),
    content.trim(),
    "",
    ...lines.slice(endIdx),
  ].join("\n");
}

async function uniqueSlug(sb: ReturnType<typeof createClient>, base: string): Promise<string> {
  const candidate = `${base}-mine`;
  for (let i = 0; i < 50; i++) {
    const trySlug = i === 0 ? candidate : `${candidate}-${i + 1}`;
    const { data } = await sb.from("skills").select("id").eq("slug", trySlug).maybeSingle();
    if (!data) return trySlug;
  }
  return `${candidate}-${Date.now()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;
    const body = (await req.json().catch(() => ({}))) as Op;

    if (!body || typeof body !== "object" || !("op" in body) || !("slug" in body)) {
      return new Response(JSON.stringify({ error: "op and slug required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Resolve target skill: must be installed by this user OR authored by this user.
    const { data: install } = await admin
      .from("skill_installs")
      .select("id, skill_id, skill:skills(*)")
      .eq("user_id", userId)
      .limit(200);
    // deno-lint-ignore no-explicit-any
    const installRow = (install ?? []).find((r: any) => r.skill?.slug === body.slug);
    // deno-lint-ignore no-explicit-any
    let skill: any = installRow?.skill ?? null;

    if (!skill) {
      const { data: owned } = await admin
        .from("skills")
        .select("*")
        .eq("slug", body.slug)
        .eq("author_user_id", userId)
        .maybeSingle();
      skill = owned;
    }
    if (!skill) {
      return new Response(JSON.stringify({ error: "skill_not_found_or_not_installed", slug: body.slug }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fork if needed (builtin / imported / not authored by this user).
    const isOwn = skill.source === "user" && skill.author_user_id === userId;
    let forkedFromSlug: string | null = null;
    if (!isOwn) {
      const newSlug = await uniqueSlug(admin, skill.slug);
      const baseManifest = { ...(skill.manifest ?? {}), slug: newSlug };
      const { data: forkRow, error: forkErr } = await admin
        .from("skills")
        .insert({
          slug: newSlug,
          name: `${skill.name} (yours)`,
          description: skill.description,
          version: skill.version || "1.0.0",
          manifest: baseManifest,
          source: "user",
          author_user_id: userId,
          visibility: "private",
          trust_tier: 1,
        })
        .select("*")
        .single();
      if (forkErr || !forkRow) {
        return new Response(JSON.stringify({ error: "fork_failed", detail: forkErr?.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      forkedFromSlug = skill.slug;
      // Re-bind install (if there was one) to the fork.
      if (installRow) {
        await admin.from("skill_installs").update({ skill_id: forkRow.id }).eq("id", installRow.id);
      } else {
        await admin.from("skill_installs").insert({
          user_id: userId, skill_id: forkRow.id, enabled: true,
        });
      }
      skill = forkRow;
    }

    // Apply patch.
    const beforeManifest = JSON.parse(JSON.stringify(skill.manifest ?? {}));
    const manifest: Record<string, unknown> = { ...(skill.manifest ?? {}) };
    let opLabel = "";

    if (body.op === "append_prerequisites") {
      const prereqs = Array.isArray(body.prerequisites) ? body.prerequisites : [];
      if (prereqs.length === 0) {
        return new Response(JSON.stringify({ error: "prerequisites array required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      manifest.instructions = appendPrerequisites(String(manifest.instructions ?? ""), prereqs);
      opLabel = "append_prerequisites";
    } else if (body.op === "patch_instructions") {
      if (typeof body.content !== "string" || !body.content.trim()) {
        return new Response(JSON.stringify({ error: "content required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      manifest.instructions = patchInstructions(
        String(manifest.instructions ?? ""),
        body.mode ?? "append",
        body.content,
        body.section,
      );
      opLabel = `patch_instructions:${body.mode ?? "append"}`;
    } else if (body.op === "update_manifest") {
      const patch = body.patch ?? {};
      for (const [k, v] of Object.entries(patch)) {
        if (MANIFEST_PATCH_ALLOW.has(k)) manifest[k] = v;
      }
      opLabel = `update_manifest:${Object.keys(patch).filter((k) => MANIFEST_PATCH_ALLOW.has(k)).join(",")}`;
    } else {
      return new Response(JSON.stringify({ error: `unknown op: ${(body as { op: string }).op}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Re-scan.
    const scan = runOzlonScan({ manifest });
    if (scan.verdict === "blocked") {
      return new Response(JSON.stringify({
        success: false,
        error: "scan_blocked",
        scan,
      }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newVersion = bumpPatch(skill.version || "1.0.0");
    manifest.version = newVersion;
    const newName = typeof manifest.name === "string" ? manifest.name : skill.name;
    const newDescription = typeof manifest.description === "string" ? manifest.description : skill.description;

    const { error: updErr } = await admin
      .from("skills")
      .update({
        manifest,
        version: newVersion,
        name: newName,
        description: newDescription,
      })
      .eq("id", skill.id);

    if (updErr) {
      return new Response(JSON.stringify({ error: "update_failed", detail: updErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Audit snapshot.
    await admin.from("skill_snapshots").insert({
      skill_id: skill.id,
      user_id: userId,
      manifest_snapshot: { before: beforeManifest, after: manifest },
      scan_report: scan as unknown as Record<string, unknown>,
      autofixes_applied: scan.autofixes_applied as unknown as Record<string, unknown>,
      source_format: "edit",
      reason: `edit:${opLabel}`,
    });

    const effective = String(manifest.instructions ?? "");
    return new Response(JSON.stringify({
      success: true,
      slug: skill.slug,
      version: newVersion,
      forked_from: forkedFromSlug,
      op: opLabel,
      effective_instructions_summary: effective.slice(0, 600),
      effective_instructions_length: effective.length,
      scan_summary: { verdict: scan.verdict, score: scan.score, findings: scan.findings.length },
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[skills-edit] fatal:", e);
    return new Response(JSON.stringify({ error: "internal_error", detail: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
