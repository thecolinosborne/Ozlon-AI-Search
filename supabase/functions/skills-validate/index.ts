// Validate a Skill manifest. Pure schema + safety checks; no DB writes.
// Returns { valid, issues, warnings, normalized } so the UI can show a report.
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adaptSkill } from "../_shared/skills/adapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Issue = { level: "error" | "warning"; field: string; message: string };

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;
const TOOL_RE = /^[a-z][a-z0-9_]{1,63}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const ALLOWED_MODES = new Set(["focus", "idle", "planning", "reactive"]);
const ALLOWED_TRIGGER_TYPES = new Set(["keyword", "intent", "signal"]);
const ALLOWED_SIDE_EFFECTS = new Set(["read", "write", "destructive"]);
const FORBIDDEN_TOOLS = new Set([
  // Tools that must never be invokable from a skill manifest
  "load_skill", // meta-tool only
  "eval", "exec", "shell", "system",
]);

// deno-lint-ignore no-explicit-any
function validate(m: any): { issues: Issue[]; warnings: Issue[] } {
  const issues: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (field: string, message: string) => issues.push({ level: "error", field, message });
  const warn = (field: string, message: string) => warnings.push({ level: "warning", field, message });

  if (!m || typeof m !== "object") {
    err("manifest", "must be a JSON object");
    return { issues, warnings };
  }

  // slug
  if (typeof m.slug !== "string" || !SLUG_RE.test(m.slug)) {
    err("slug", "must be lowercase-kebab, 3-60 chars, no leading/trailing dash");
  }
  // name
  if (typeof m.name !== "string" || m.name.length < 3 || m.name.length > 80) {
    err("name", "string, 3-80 chars");
  }
  // description
  if (typeof m.description !== "string" || m.description.length < 10 || m.description.length > 280) {
    err("description", "string, 10-280 chars");
  }
  // version
  if (typeof m.version !== "string" || !SEMVER_RE.test(m.version)) {
    err("version", "must be semver e.g. 1.0.0");
  }
  // triggers
  if (!Array.isArray(m.triggers) || m.triggers.length === 0) {
    err("triggers", "at least one trigger required");
  } else {
    m.triggers.forEach((t: unknown, i: number) => {
      // deno-lint-ignore no-explicit-any
      const tt = t as any;
      if (!tt || !ALLOWED_TRIGGER_TYPES.has(tt.type)) {
        err(`triggers[${i}].type`, `must be one of ${[...ALLOWED_TRIGGER_TYPES].join(", ")}`);
        return;
      }
      if (tt.type === "keyword") {
        if (!Array.isArray(tt.match) || tt.match.length === 0) {
          err(`triggers[${i}].match`, "keyword triggers need a non-empty match[] array");
        } else if (tt.match.some((k: unknown) => typeof k !== "string" || !k.trim())) {
          err(`triggers[${i}].match`, "all keywords must be non-empty strings");
        }
      } else {
        if (typeof tt.match !== "string" || !tt.match.trim()) {
          err(`triggers[${i}].match`, "match must be a non-empty string");
        }
      }
    });
  }
  // tools
  if (!Array.isArray(m.tools_required)) {
    err("tools_required", "must be an array (use [] if none)");
  } else {
    m.tools_required.forEach((t: unknown, i: number) => {
      if (typeof t !== "string" || !TOOL_RE.test(t)) {
        err(`tools_required[${i}]`, `invalid tool name "${String(t)}"`);
      } else if (FORBIDDEN_TOOLS.has(t)) {
        err(`tools_required[${i}]`, `tool "${t}" cannot be used inside a skill`);
      }
    });
    if (m.tools_required.length > 25) {
      warn("tools_required", "skill uses many tools — consider splitting into smaller skills");
    }
  }
  if (m.tools_optional !== undefined) {
    if (!Array.isArray(m.tools_optional)) {
      err("tools_optional", "must be an array");
    } else {
      m.tools_optional.forEach((t: unknown, i: number) => {
        if (typeof t !== "string" || !TOOL_RE.test(t)) {
          err(`tools_optional[${i}]`, `invalid tool name "${String(t)}"`);
        } else if (FORBIDDEN_TOOLS.has(t)) {
          err(`tools_optional[${i}]`, `tool "${t}" cannot be used inside a skill`);
        }
      });
    }
  }
  // modes
  if (m.modes_allowed !== undefined) {
    if (!Array.isArray(m.modes_allowed)) {
      err("modes_allowed", "must be an array");
    } else {
      m.modes_allowed.forEach((mo: unknown, i: number) => {
        if (typeof mo !== "string" || !ALLOWED_MODES.has(mo)) {
          err(`modes_allowed[${i}]`, `must be one of ${[...ALLOWED_MODES].join(", ")}`);
        }
      });
    }
  }
  // side_effect
  if (m.side_effect !== undefined && !ALLOWED_SIDE_EFFECTS.has(m.side_effect)) {
    err("side_effect", `must be one of ${[...ALLOWED_SIDE_EFFECTS].join(", ")}`);
  }
  // instructions
  if (typeof m.instructions !== "string" || m.instructions.trim().length < 20) {
    err("instructions", "string, at least 20 chars of guidance");
  } else if (m.instructions.length > 10000) {
    err("instructions", "instructions exceed 10,000 char limit");
  }
  // safety nudges
  if (m.side_effect === "destructive" && m.requires_confirmation !== true) {
    warn("requires_confirmation", "destructive skills should set requires_confirmation: true");
  }
  if (
    Array.isArray(m.tools_required) &&
    m.tools_required.some((t: string) =>
      typeof t === "string" && (t.includes("delete") || t.includes("trash") || t.includes("send"))
    ) &&
    m.requires_confirmation !== true
  ) {
    warn("requires_confirmation", "skill uses send/delete tools — consider requires_confirmation: true");
  }

  return { issues, warnings };
}

// deno-lint-ignore no-explicit-any
function normalize(m: any) {
  return {
    slug: String(m.slug),
    name: String(m.name),
    description: String(m.description),
    version: String(m.version),
    triggers: m.triggers,
    tools_required: m.tools_required ?? [],
    tools_optional: m.tools_optional ?? [],
    memory_domains: m.memory_domains ?? [],
    modes_allowed: m.modes_allowed ?? [],
    instructions: String(m.instructions).trim(),
    side_effect: m.side_effect ?? "read",
    requires_confirmation: !!m.requires_confirmation,
    ...(m.ui && typeof m.ui === "object" ? { ui: m.ui } : {}),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null);
    let manifest = body?.manifest;
    const source: string | undefined = typeof body?.source === "string" ? body.source : undefined;
    const companionSource: string | undefined = typeof body?.companion === "string" ? body.companion : undefined;
    const install = !!body?.install;
    let detectedFormat: string | undefined;

    if (!manifest && source) {
      const adapted = adaptSkill(source, companionSource);
      detectedFormat = adapted.format;
      if (!adapted.manifest) {
        return new Response(
          JSON.stringify({
            valid: false,
            issues: [{ level: "error", field: "source", message: adapted.error || "could not parse skill source" }],
            warnings: [],
            normalized: null,
            format: detectedFormat,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      manifest = adapted.manifest;
    }

    if (!manifest) {
      return new Response(JSON.stringify({ error: "manifest or source required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { issues, warnings } = validate(manifest);
    const valid = issues.length === 0;

    // Slug uniqueness check (warn only — DB will enforce on insert)
    if (valid) {
      const { data: existing } = await supabase
        .from("skills")
        .select("id, source, author_user_id")
        .eq("slug", manifest.slug)
        .maybeSingle();
      if (existing) {
        if (existing.source === "builtin") {
          issues.push({ level: "error", field: "slug", message: "slug conflicts with a built-in skill" });
        } else if (existing.author_user_id !== userData.user.id) {
          issues.push({ level: "error", field: "slug", message: "slug already taken by another user's skill" });
        } else {
          warnings.push({ level: "warning", field: "slug", message: "you already have a skill with this slug — installing will conflict" });
        }
      }
    }

    const normalized = valid ? normalize(manifest) : null;
    const finalValid = issues.length === 0;

    let installed: { id: string; slug: string } | null = null;
    if (install && finalValid && normalized) {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: inserted, error: insErr } = await sb
        .from("skills")
        .insert({
          slug: normalized.slug,
          name: normalized.name,
          description: normalized.description,
          version: normalized.version,
          manifest: normalized,
          source: "imported",
          visibility: "private",
          trust_tier: 2,
          author_user_id: userData.user.id,
        })
        .select("id, slug")
        .single();
      if (insErr) {
        return new Response(
          JSON.stringify({ valid: false, issues: [{ level: "error", field: "db", message: insErr.message }], warnings }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      installed = inserted;
    }

    return new Response(
      JSON.stringify({ valid: finalValid, issues, warnings, normalized, installed, format: detectedFormat }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[skills-validate] error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
