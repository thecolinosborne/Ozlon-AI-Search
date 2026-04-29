// skills-ingest: the Claude-style drop-in pipeline.
// Accepts files / raw source / a free-form prompt, normalizes via AI to an
// Ozlon manifest, runs the Ozlon Compatibility Scan, and (if not blocked)
// installs + auto-enables the skill in one call.
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adaptSkill } from "../_shared/skills/adapter.ts";
import { runOzlonScan, type ScanReport } from "../_shared/skills/scan.ts";
import { catalogForPrompt, KNOWN_TOOLS } from "../_shared/skills/tool-catalog.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_FILES = 50;
const MAX_TOTAL_BYTES = 5_000_000; // 5 MB
const INLINE_TEXT_LIMIT = 32_000; // anything larger goes to storage

// deno-lint-ignore no-explicit-any
type IngestFile = { path: string; content: string; encoding?: "utf8" | "base64" };

interface IngestBody {
  files?: IngestFile[];
  source?: string;
  companion?: string;
  prompt?: string;
  install?: boolean;
  force?: boolean; // install even with warn-level findings
}

function isText(path: string): boolean {
  return /\.(md|markdown|txt|json|yaml|yml|skill|mdx)$/i.test(path);
}

function pickPrimary(files: IngestFile[]): IngestFile | null {
  // 1. SKILL.md / skill.md
  let f = files.find((x) => /(^|\/)SKILL\.md$/i.test(x.path)) ||
          files.find((x) => /(^|\/)skill\.md$/i.test(x.path));
  if (f) return f;
  // 2. Native JSON manifest
  f = files.find((x) => /\.skill\.json$/i.test(x.path)) ||
      files.find((x) => /(^|\/)manifest\.json$/i.test(x.path)) ||
      files.find((x) => /(^|\/)skill\.json$/i.test(x.path));
  if (f) return f;
  // 3. Any md file at root of bundle
  f = files.find((x) => /\.md$/i.test(x.path) && !x.path.includes("/"));
  if (f) return f;
  // 4. First yaml
  return files.find((x) => /\.(ya?ml)$/i.test(x.path)) ?? null;
}

function pickCompanion(files: IngestFile[], primaryPath: string | null): IngestFile | null {
  const f = files.find((x) =>
    x.path !== primaryPath && /\.(ya?ml)$/i.test(x.path) &&
    /(companion|interface|ui)/i.test(x.path)
  );
  return f ?? files.find((x) => x.path !== primaryPath && /\.(ya?ml)$/i.test(x.path)) ?? null;
}

async function aiNormalize(args: {
  source?: string;
  prompt?: string;
  context?: string; // bundled file list
}): Promise<{ ok: true; manifest: Record<string, unknown> } | { ok: false; error: string }> {
  if (!LOVABLE_API_KEY) return { ok: false, error: "LOVABLE_API_KEY not configured" };

  const sys = [
    "You convert any kind of skill description into a strict Ozlon Skill manifest.",
    "Output via the emit_skill_manifest tool — never plain text.",
    "Pick tool names ONLY from this catalog:",
    catalogForPrompt(),
    "Rules:",
    "- slug: kebab-case, 3-60 chars, no leading/trailing dash",
    "- triggers: at least one keyword trigger with 1-5 short trigger phrases",
    "- instructions: clear step-by-step playbook (>=20 chars, <=8000)",
    "- side_effect: read | write | destructive (pick the most accurate)",
    "- requires_confirmation: true if destructive",
  ].join("\n");

  const userParts: string[] = [];
  if (args.prompt) userParts.push(`User asked for a skill that does this:\n${args.prompt}`);
  if (args.source) userParts.push(`Source material:\n\n${args.source.slice(0, 30_000)}`);
  if (args.context) userParts.push(`\nBundled files:\n${args.context}`);

  const tool = {
    type: "function",
    function: {
      name: "emit_skill_manifest",
      description: "Emit a normalized Ozlon Skill manifest.",
      parameters: {
        type: "object",
        properties: {
          slug: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          version: { type: "string" },
          triggers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["keyword"] },
                match: { type: "array", items: { type: "string" } },
              },
              required: ["type", "match"],
            },
          },
          tools_required: { type: "array", items: { type: "string" } },
          tools_optional: { type: "array", items: { type: "string" } },
          instructions: { type: "string" },
          side_effect: { type: "string", enum: ["read", "write", "destructive"] },
          requires_confirmation: { type: "boolean" },
        },
        required: ["slug", "name", "description", "version", "triggers", "tools_required", "instructions"],
      },
    },
  };

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userParts.join("\n\n") },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "emit_skill_manifest" } },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return { ok: false, error: `AI gateway ${resp.status}: ${text.slice(0, 300)}` };
  }
  const data = await resp.json();
  const call = data?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call?.function?.arguments) return { ok: false, error: "AI did not return a manifest" };
  try {
    const manifest = JSON.parse(call.function.arguments);
    // defaults
    manifest.version ??= "1.0.0";
    manifest.tools_optional ??= [];
    manifest.side_effect ??= "read";
    manifest.requires_confirmation ??= manifest.side_effect === "destructive";
    return { ok: true, manifest };
  } catch (e) {
    return { ok: false, error: `Invalid manifest JSON: ${e instanceof Error ? e.message : e}` };
  }
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
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = (await req.json().catch(() => ({}))) as IngestBody;
    const install = body.install !== false; // default true
    const force = !!body.force;

    let files = Array.isArray(body.files) ? body.files : [];
    if (files.length > MAX_FILES) {
      return new Response(JSON.stringify({ error: `too many files (max ${MAX_FILES})` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const totalBytes = files.reduce((s, f) => s + (f.content?.length ?? 0), 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      return new Response(JSON.stringify({ error: `bundle too large (max 5MB)` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Refuse raw .zip blobs — they must be unpacked client-side first.
    if (files.length > 0 && files.every((f) => /\.zip$/i.test(f.path))) {
      return new Response(JSON.stringify({
        error: "zip_not_unpacked",
        message: "The .zip file wasn't unpacked before upload. Please drop the contents (or the unzipped folder) instead.",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---------- 1. Decide primary input ----------
    let manifest: Record<string, unknown> | null = null;
    let detectedFormat: string | undefined;
    let companionSource: string | undefined = body.companion;
    let primarySource: string | undefined = body.source;

    if (files.length > 0) {
      const primary = pickPrimary(files);
      const companion = pickCompanion(files, primary?.path ?? null);
      if (primary) primarySource = primary.encoding === "base64"
        ? new TextDecoder().decode(Uint8Array.from(atob(primary.content), c => c.charCodeAt(0)))
        : primary.content;
      if (companion) companionSource = companion.encoding === "base64"
        ? new TextDecoder().decode(Uint8Array.from(atob(companion.content), c => c.charCodeAt(0)))
        : companion.content;
    }

    // ---------- 2. Adapt known formats first (cheap path) ----------
    if (primarySource) {
      const adapted = adaptSkill(primarySource, companionSource);
      detectedFormat = adapted.format;
      if (adapted.manifest) {
        manifest = adapted.manifest;
      }
    }

    // ---------- 3. AI normalize fallback (or always for prompt-only) ----------
    const needsAI = !manifest || body.prompt;
    if (needsAI) {
      const fileContext = files.length
        ? files.map((f) => `- ${f.path} (${f.content.length} chars)`).join("\n")
        : undefined;
      const result = await aiNormalize({
        prompt: body.prompt,
        source: primarySource,
        context: fileContext,
      });
      if (!result.ok) {
        return new Response(JSON.stringify({
          error: "ingest_failed",
          message: result.error,
          phase: "ai_normalize",
        }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Prefer adapter output if present (more faithful), but merge AI's gaps
      if (manifest) {
        manifest = { ...result.manifest, ...manifest };
      } else {
        manifest = result.manifest;
        detectedFormat = detectedFormat ?? "ai_generated";
      }
    }

    if (!manifest) {
      return new Response(JSON.stringify({ error: "no source could be parsed" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------- 4. Slug existence check (for scan) ----------
    const { data: allSlugRows } = await userClient
      .from("skills")
      .select("slug, source, author_user_id")
      .limit(1000);
    const builtin = new Set<string>();
    const ownByThisUser = new Set<string>();
    const ownByOthers = new Set<string>();
    for (const r of allSlugRows ?? []) {
      if (r.source === "builtin") builtin.add(r.slug);
      else if (r.author_user_id === userId) ownByThisUser.add(r.slug);
      else ownByOthers.add(r.slug);
    }

    // ---------- 5. Build asset list (for scan + later persistence) ----------
    const assetRows: Array<{ path: string; content_text: string | null; size_bytes: number; content_type: string }> = [];
    const primaryPath = pickPrimary(files)?.path ?? null;
    for (const f of files) {
      if (f.path === primaryPath) continue;
      const isTextual = isText(f.path) || f.encoding !== "base64";
      assetRows.push({
        path: f.path,
        content_text: isTextual ? (f.encoding === "base64"
          ? new TextDecoder().decode(Uint8Array.from(atob(f.content), c => c.charCodeAt(0)))
          : f.content).slice(0, INLINE_TEXT_LIMIT) : null,
        size_bytes: f.content.length,
        content_type: isTextual ? "text/plain" : "application/octet-stream",
      });
    }

    // ---------- 6. Run Ozlon scan (mutates manifest with autofixes) ----------
    const scan: ScanReport = runOzlonScan({
      manifest,
      assets: assetRows.map(a => ({ path: a.path, content_text: a.content_text, size_bytes: a.size_bytes })),
      existingSlugs: { builtin, ownByThisUser, ownByOthers },
    });

    // ---------- 7. Decide if we install ----------
    const blocked = scan.verdict === "blocked";
    const needsForce = scan.verdict === "needs_review" && !force;
    const willInstall = install && !blocked && !needsForce;

    if (!willInstall) {
      return new Response(JSON.stringify({
        ok: true,
        installed: null,
        manifest,
        scan,
        format: detectedFormat,
        reason: blocked ? "blocked" : (needsForce ? "needs_review" : "validate_only"),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---------- 8. Install with service role ----------
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Insert skill
    const { data: insertedSkill, error: skillErr } = await admin
      .from("skills")
      .insert({
        slug: manifest.slug as string,
        name: manifest.name as string,
        description: manifest.description as string,
        version: (manifest.version as string) ?? "1.0.0",
        manifest,
        source: "imported",
        visibility: "private",
        trust_tier: 2,
        author_user_id: userId,
      })
      .select("id, slug")
      .single();

    if (skillErr || !insertedSkill) {
      return new Response(JSON.stringify({
        error: "install_failed",
        message: skillErr?.message ?? "unknown",
        scan,
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Auto-install (enabled) for the user
    await admin.from("skill_installs").insert({
      user_id: userId,
      skill_id: insertedSkill.id,
      enabled: true,
    });

    // Persist assets (inline only for now; storage upload is a future enhancement)
    if (assetRows.length > 0) {
      await admin.from("skill_assets").insert(
        assetRows.map((a) => ({
          skill_id: insertedSkill.id,
          user_id: userId,
          path: a.path,
          content_type: a.content_type,
          content_text: a.content_text,
          storage_path: null,
          size_bytes: a.size_bytes,
        })),
      );
    }

    // Snapshot for audit
    await admin.from("skill_snapshots").insert({
      skill_id: insertedSkill.id,
      user_id: userId,
      manifest_snapshot: manifest,
      scan_report: scan,
      autofixes_applied: scan.autofixes_applied,
      source_format: detectedFormat ?? "unknown",
      reason: "install",
    });

    return new Response(JSON.stringify({
      ok: true,
      installed: insertedSkill,
      manifest,
      scan,
      format: detectedFormat,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("[skills-ingest] error:", e);
    return new Response(JSON.stringify({
      error: "internal",
      message: e instanceof Error ? e.message : String(e),
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

// silence unused import warning if KNOWN_TOOLS isn't referenced (kept for type completeness)
void KNOWN_TOOLS;
