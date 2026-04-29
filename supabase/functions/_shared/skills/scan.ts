// Ozlon Compatibility Scan
// Pure in-process checks (regex + heuristics, no extra API call) that run
// after manifest validation and before install. Returns a structured report
// and applies safe autofixes to the manifest in-place.

import { TOOL_NAMES, getTool } from "./tool-catalog.ts";

export type Severity = "info" | "warn" | "block";
export type Verdict = "safe" | "needs_review" | "blocked";

export interface ScanFinding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  field?: string;
  autofixed?: boolean;
}

export interface ScanReport {
  verdict: Verdict;
  score: number; // 0-100
  findings: ScanFinding[];
  autofixes_applied: string[];
  external_urls: string[];
}

export interface ScanInput {
  // deno-lint-ignore no-explicit-any
  manifest: Record<string, any>;
  assets?: Array<{ path: string; content_text?: string | null; size_bytes: number }>;
  existingSlugs?: { builtin: Set<string>; ownByThisUser: Set<string>; ownByOthers: Set<string> };
}

// Patterns that look like leaked secrets
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "OpenAI key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Anthropic key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: "GitHub token", re: /\bghp_[A-Za-z0-9]{30,}\b/g },
];

// Phrases commonly used in prompt-injection attempts
const INJECTION_PHRASES = [
  "ignore previous instructions",
  "ignore the above",
  "disregard prior",
  "you are now",
  "system prompt:",
  "<system>",
  "</system>",
  "reveal your instructions",
  "print your prompt",
];

const URL_RE = /\bhttps?:\/\/[^\s)>"']+/gi;
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF\u2060]/g;

const DESTRUCTIVE_HINT_RE = /(delete|destroy|trash|wipe|drop_)/i;
const WRITE_HINT_RE = /(send_|create_|update_|append_|post|publish)/i;

export function runOzlonScan(input: ScanInput): ScanReport {
  const findings: ScanFinding[] = [];
  const autofixes: string[] = [];
  const externalUrls = new Set<string>();
  const m = input.manifest;

  const instructions: string = typeof m.instructions === "string" ? m.instructions : "";
  const assets = input.assets ?? [];

  // ---------- 1. Secret leakage (BLOCK) ----------
  const allText =
    instructions +
    "\n" +
    assets.map((a) => a.content_text ?? "").join("\n");
  for (const { name, re } of SECRET_PATTERNS) {
    const hits = allText.match(re);
    if (hits && hits.length > 0) {
      findings.push({
        id: "secret_leakage",
        severity: "block",
        title: `Possible ${name} found in skill content`,
        detail: `Detected ${hits.length} match(es). Skills must never contain credentials. Strip them before installing.`,
        field: "instructions",
      });
    }
  }

  // ---------- 2. Forbidden tools (BLOCK — already caught by validate, defensive) ----------
  const FORBIDDEN = new Set(["eval", "exec", "shell", "system", "load_skill"]);
  const reqTools: string[] = Array.isArray(m.tools_required) ? m.tools_required : [];
  const optTools: string[] = Array.isArray(m.tools_optional) ? m.tools_optional : [];
  for (const t of [...reqTools, ...optTools]) {
    if (FORBIDDEN.has(t)) {
      findings.push({
        id: "forbidden_tool",
        severity: "block",
        title: `Forbidden tool: ${t}`,
        detail: `Skills cannot invoke "${t}". Remove it from the manifest.`,
        field: "tools_required",
      });
    }
  }

  // ---------- 3. Unknown tools (WARN — autofix to optional, BLOCK if >50%) ----------
  const unknownReq = reqTools.filter((t) => !TOOL_NAMES.has(t) && !FORBIDDEN.has(t));
  if (unknownReq.length > 0) {
    const ratio = unknownReq.length / Math.max(reqTools.length, 1);
    if (ratio > 0.5) {
      findings.push({
        id: "too_many_unknown_tools",
        severity: "block",
        title: `${unknownReq.length} of ${reqTools.length} required tools are unknown to Ozlon`,
        detail: `Unknown: ${unknownReq.join(", ")}. This skill likely won't work without rewriting.`,
        field: "tools_required",
      });
    } else {
      // Autofix: move unknown required tools to optional so the skill can still partially run
      m.tools_required = reqTools.filter((t) => !unknownReq.includes(t));
      m.tools_optional = Array.from(new Set([...(optTools), ...unknownReq]));
      autofixes.push(`moved unknown tools to optional: ${unknownReq.join(", ")}`);
      findings.push({
        id: "unknown_tools_demoted",
        severity: "warn",
        title: `${unknownReq.length} unknown tool(s) demoted to optional`,
        detail: `These tools aren't in Ozlon's catalog: ${unknownReq.join(", ")}. The skill will run without them.`,
        field: "tools_required",
        autofixed: true,
      });
    }
  }

  // ---------- 4. Side-effect mismatch (WARN + autofix) ----------
  const declaredSideEffect: string = m.side_effect ?? "read";
  const allTools = [...reqTools, ...optTools];
  const hasDestructive = allTools.some((t) => {
    const meta = getTool(t);
    return meta?.side_effect === "destructive" || DESTRUCTIVE_HINT_RE.test(t);
  });
  const hasWrite = allTools.some((t) => {
    const meta = getTool(t);
    return meta?.side_effect === "write" || WRITE_HINT_RE.test(t);
  });

  if (hasDestructive && declaredSideEffect !== "destructive") {
    m.side_effect = "destructive";
    autofixes.push(`side_effect: ${declaredSideEffect} → destructive`);
    findings.push({
      id: "side_effect_upgraded_destructive",
      severity: "warn",
      title: "Side effect upgraded to destructive",
      detail: "Skill uses tools that delete or trash data. Marked as destructive.",
      field: "side_effect",
      autofixed: true,
    });
  } else if (hasWrite && declaredSideEffect === "read") {
    m.side_effect = "write";
    autofixes.push(`side_effect: read → write`);
    findings.push({
      id: "side_effect_upgraded_write",
      severity: "warn",
      title: "Side effect upgraded to write",
      detail: "Skill uses tools that send/create/update data. Marked as write.",
      field: "side_effect",
      autofixed: true,
    });
  }

  // ---------- 5. Destructive without confirmation (autofix) ----------
  if (m.side_effect === "destructive" && m.requires_confirmation !== true) {
    m.requires_confirmation = true;
    autofixes.push("requires_confirmation → true");
    findings.push({
      id: "confirmation_enforced",
      severity: "warn",
      title: "Confirmation enforced for destructive skill",
      detail: "Destructive skills must ask before acting. This is now enforced.",
      field: "requires_confirmation",
      autofixed: true,
    });
  }

  // ---------- 6. Prompt-injection sniff (WARN, no autofix) ----------
  const lowered = instructions.toLowerCase();
  const injectHits = INJECTION_PHRASES.filter((p) => lowered.includes(p));
  if (injectHits.length > 0) {
    findings.push({
      id: "possible_prompt_injection",
      severity: "warn",
      title: "Skill instructions contain prompt-injection language",
      detail: `Phrases like ${injectHits.map((p) => `"${p}"`).join(", ")} are commonly used to override system instructions. Review carefully.`,
      field: "instructions",
    });
  }

  // ---------- 7. Hidden unicode (WARN + autofix strip) ----------
  if (ZERO_WIDTH_RE.test(instructions)) {
    m.instructions = instructions.replace(ZERO_WIDTH_RE, "");
    autofixes.push("stripped zero-width characters from instructions");
    findings.push({
      id: "hidden_unicode_stripped",
      severity: "warn",
      title: "Hidden zero-width characters removed",
      detail: "Skill instructions contained invisible unicode characters. They've been stripped.",
      field: "instructions",
      autofixed: true,
    });
  }

  // ---------- 8. External URLs (INFO) ----------
  const urlSources = [instructions, ...assets.map((a) => a.content_text ?? "")];
  for (const src of urlSources) {
    const matches = src.match(URL_RE);
    if (matches) for (const u of matches) externalUrls.add(u.replace(/[.,;)\]>]+$/, ""));
  }
  if (externalUrls.size > 0) {
    findings.push({
      id: "external_urls",
      severity: "info",
      title: `Skill references ${externalUrls.size} external URL(s)`,
      detail: Array.from(externalUrls).slice(0, 10).join("\n"),
    });
  }

  // ---------- 9. Slug collision (BLOCK on builtin / others, WARN on own) ----------
  if (input.existingSlugs && typeof m.slug === "string") {
    if (input.existingSlugs.builtin.has(m.slug)) {
      findings.push({
        id: "slug_collides_builtin",
        severity: "block",
        title: "Slug conflicts with a built-in skill",
        detail: `"${m.slug}" is already used by an Ozlon built-in. Pick a different slug.`,
        field: "slug",
      });
    } else if (input.existingSlugs.ownByOthers.has(m.slug)) {
      findings.push({
        id: "slug_collides_other_user",
        severity: "block",
        title: "Slug taken by another user's skill",
        detail: `"${m.slug}" is owned by someone else. Pick a different slug.`,
        field: "slug",
      });
    } else if (input.existingSlugs.ownByThisUser.has(m.slug)) {
      findings.push({
        id: "slug_already_yours",
        severity: "warn",
        title: "You already have a skill with this slug",
        detail: `Installing will conflict with your existing "${m.slug}". Rename or remove the old one first.`,
        field: "slug",
      });
    }
  }

  // ---------- 10. Asset safety ----------
  const execAsset = assets.find((a) => /\.(sh|bat|ps1|exe|dll)$/i.test(a.path));
  if (execAsset) {
    findings.push({
      id: "executable_asset",
      severity: "warn",
      title: "Skill bundles an executable file",
      detail: `${execAsset.path} looks executable. Ozlon will not run it but it'll be stored.`,
    });
  }
  const totalAssetBytes = assets.reduce((sum, a) => sum + a.size_bytes, 0);
  if (totalAssetBytes > 2_000_000) {
    findings.push({
      id: "asset_size",
      severity: "warn",
      title: "Bundled assets exceed 2 MB",
      detail: `Total: ${(totalAssetBytes / 1024 / 1024).toFixed(1)} MB across ${assets.length} files. Consider trimming.`,
    });
  }

  // ---------- 11. Size sanity ----------
  if (instructions.length > 8000) {
    findings.push({
      id: "instructions_long",
      severity: "info",
      title: "Long instructions",
      detail: `${instructions.length} chars. Consider tightening — long instructions can dilute focus.`,
    });
  }
  if ((reqTools.length + optTools.length) > 25) {
    findings.push({
      id: "many_tools",
      severity: "warn",
      title: "Skill uses many tools",
      detail: `${reqTools.length + optTools.length} tools total. Consider splitting into smaller, composable skills.`,
    });
  }

  // ---------- Verdict + score ----------
  const blocks = findings.filter((f) => f.severity === "block").length;
  const warns = findings.filter((f) => f.severity === "warn" && !f.autofixed).length;
  const autofixedWarns = findings.filter((f) => f.severity === "warn" && f.autofixed).length;

  const verdict: Verdict = blocks > 0 ? "blocked" : warns > 0 ? "needs_review" : "safe";
  const score = Math.max(0, 100 - blocks * 50 - warns * 8 - autofixedWarns * 2);

  return {
    verdict,
    score,
    findings,
    autofixes_applied: autofixes,
    external_urls: Array.from(externalUrls),
  };
}
