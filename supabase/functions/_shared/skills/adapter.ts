// Multi-format Skill manifest adapter.
// Normalizes Native JSON, Claude SKILL.md (YAML frontmatter + Markdown),
// and OpenAI-style YAML companion files into the proprietary Ozlon manifest.

import { parse as parseYaml } from "https://deno.land/std@0.224.0/yaml/parse.ts";

export type DetectedFormat = "json" | "md" | "yaml" | "unknown";

export interface AdapterResult {
  format: DetectedFormat;
  // deno-lint-ignore no-explicit-any
  manifest: Record<string, any> | null;
  // deno-lint-ignore no-explicit-any
  companion?: Record<string, any> | null;
  error?: string;
}

const STOPWORDS = new Set([
  "the","a","an","and","or","of","to","for","in","on","with","by","from","into","that","this","is","be","are","as","at","it","you","your","its","their","they","we","our","us","i","me","my","but","not","if","then","than","so","do","does","done","will","can","could","should","would","may","might","must","use","using","used","when","where","what","who","which","how","via","over","up","down","out","just","also","very","more","less","one","two","new","make","makes","made","get","gets","got",
]);

function kebab(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function detectFormat(source: string): DetectedFormat {
  const trimmed = source.trim();
  if (!trimmed) return "unknown";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (trimmed.startsWith("---")) return "md";
  // YAML companion: top-level "interface:" or other yaml-ish keys
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/m.test(trimmed)) return "yaml";
  return "unknown";
}

export function inferTriggers(description: string, name: string): Array<{ type: "keyword"; match: string[] }> {
  const text = `${name} ${description}`.toLowerCase();
  const phrases = new Set<string>();
  // Multi-word noun-ish phrases
  const ngramRe = /\b([a-z][a-z0-9]+ [a-z][a-z0-9]+(?: [a-z][a-z0-9]+)?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = ngramRe.exec(text)) !== null) {
    const phrase = m[1];
    const words = phrase.split(" ");
    if (words.every((w) => STOPWORDS.has(w))) continue;
    if (words.some((w) => w.length < 3)) continue;
    phrases.add(phrase);
    if (phrases.size >= 6) break;
  }
  // Fallback single-word terms
  if (phrases.size < 2) {
    for (const w of text.split(/[^a-z0-9]+/)) {
      if (w.length >= 4 && !STOPWORDS.has(w)) phrases.add(w);
      if (phrases.size >= 4) break;
    }
  }
  const match = Array.from(phrases).slice(0, 4);
  if (match.length === 0) match.push(kebab(name).replace(/-/g, " "));
  return [{ type: "keyword", match }];
}

/** Parse YAML frontmatter from a Markdown file. Returns { data, body } or null. */
// deno-lint-ignore no-explicit-any
function parseFrontmatter(source: string): { data: Record<string, any>; body: string } | null {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  try {
    // deno-lint-ignore no-explicit-any
    const data = (parseYaml(m[1]) as Record<string, any>) ?? {};
    return { data, body: m[2] ?? "" };
  } catch {
    return null;
  }
}

/** Adapt Claude-style SKILL.md → Ozlon manifest (lossy where unspecified). */
// deno-lint-ignore no-explicit-any
function adaptClaudeSkillMd(source: string): Record<string, any> | null {
  const fm = parseFrontmatter(source);
  if (!fm) return null;
  const name = String(fm.data.name ?? "").trim();
  const description = String(fm.data.description ?? "").trim();
  if (!name) return null;
  const slug = kebab(name);
  const instructions = fm.body.trim();
  return {
    slug,
    name,
    description: description || `Imported skill: ${name}`,
    version: String(fm.data.version ?? "1.0.0"),
    triggers: inferTriggers(description, name),
    tools_required: Array.isArray(fm.data.tools_required) ? fm.data.tools_required : [],
    tools_optional: Array.isArray(fm.data.tools_optional) ? fm.data.tools_optional : [],
    memory_domains: Array.isArray(fm.data.memory_domains) ? fm.data.memory_domains : [],
    modes_allowed: Array.isArray(fm.data.modes_allowed) ? fm.data.modes_allowed : [],
    instructions,
    side_effect: fm.data.side_effect ?? "read",
    requires_confirmation: !!fm.data.requires_confirmation,
  };
}

/** Adapt OpenAI-style YAML companion. Either standalone (rare) or merged via mergeCompanion. */
// deno-lint-ignore no-explicit-any
function adaptYaml(source: string): { manifest: Record<string, any> | null; companion: Record<string, any> | null; error?: string } {
  try {
    // deno-lint-ignore no-explicit-any
    const data = parseYaml(source) as Record<string, any>;
    if (!data || typeof data !== "object") return { manifest: null, companion: null, error: "yaml is not an object" };
    // Pure companion (only ui metadata)
    if (data.interface && !data.instructions && !data.triggers) {
      return { manifest: null, companion: data };
    }
    // Looks like a full manifest authored in YAML — convert as-is
    return { manifest: data, companion: null };
  } catch (e) {
    return { manifest: null, companion: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Merge an OpenAI companion's `interface` block into a manifest under `manifest.ui`. */
export function mergeCompanion(
  // deno-lint-ignore no-explicit-any
  manifest: Record<string, any>,
  // deno-lint-ignore no-explicit-any
  companion: Record<string, any> | null | undefined,
  // deno-lint-ignore no-explicit-any
): Record<string, any> {
  if (!companion) return manifest;
  const iface = companion.interface ?? companion;
  const ui = {
    display_name: iface.display_name,
    short_description: iface.short_description,
    icon: iface.icon,
    brand_color: iface.brand_color,
  };
  return { ...manifest, ui: { ...(manifest.ui ?? {}), ...ui } };
}

/** Main entrypoint: take raw source text + optional companion text, return normalized manifest. */
export function adaptSkill(source: string, companionSource?: string): AdapterResult {
  const fmt = detectFormat(source);
  // deno-lint-ignore no-explicit-any
  let manifest: Record<string, any> | null = null;
  // deno-lint-ignore no-explicit-any
  let companion: Record<string, any> | null = null;

  if (fmt === "json") {
    try {
      manifest = JSON.parse(source);
    } catch (e) {
      return { format: fmt, manifest: null, error: e instanceof Error ? e.message : String(e) };
    }
  } else if (fmt === "md") {
    manifest = adaptClaudeSkillMd(source);
    if (!manifest) return { format: fmt, manifest: null, error: "could not parse SKILL.md frontmatter" };
  } else if (fmt === "yaml") {
    const r = adaptYaml(source);
    if (r.error) return { format: fmt, manifest: null, error: r.error };
    manifest = r.manifest;
    companion = r.companion;
    if (!manifest && !companion) return { format: fmt, manifest: null, error: "yaml had neither manifest nor companion shape" };
  } else {
    return { format: fmt, manifest: null, error: "unrecognized format (expected JSON, SKILL.md, or YAML)" };
  }

  if (companionSource) {
    const cr = adaptYaml(companionSource);
    if (cr.companion) companion = cr.companion;
  }

  if (manifest && companion) manifest = mergeCompanion(manifest, companion);

  return { format: fmt, manifest, companion };
}
