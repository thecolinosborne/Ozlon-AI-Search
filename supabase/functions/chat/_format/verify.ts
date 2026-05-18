// Formatting Engine 2026 — Phase 2: self-check verifier.
//
// Lightweight post-generation pass that checks the assistant's final text
// against the chosen FormatMode's rules. Scalable across all 6 modes via a
// per-mode checklist registry. Off / shadow / active operating modes are
// controlled by env so we can dark-launch, observe, then flip repair on.
//
// Env vars:
//   FORMAT_VERIFIER_MODE   = off | shadow | active   (default: shadow)
//     - off     → no calls, no events
//     - shadow  → run check, emit telemetry event, never repair
//     - active  → run check, request repair when ok=false, emit replacement
//   FORMAT_VERIFIER_MODES  = comma list of FormatModes to verify
//                            (default: DOCUMENT,LONGFORM)
//   FORMAT_VERIFIER_MODEL  = gateway model id
//                            (default: google/gemini-3-flash-lite-preview)
//   FORMAT_VERIFIER_MIN_CHARS = skip outputs shorter than N chars
//                                (default: 200)

import type { FormatMode } from "./cards.ts";

export interface VerifyResult {
  ok: boolean;
  issues: string[];
  repairedText?: string;
  model: string;
  latencyMs: number;
  skipped?: string;
}

export type VerifierOperatingMode = "off" | "shadow" | "active";

export interface VerifierConfig {
  opMode: VerifierOperatingMode;
  modes: Set<string>;
  model: string;
  minChars: number;
}

const DEFAULT_MODEL = "google/gemini-3-flash-lite-preview";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// Per-mode checklists. Adding a new mode = adding a key here. The router
// already classifies into one of these, so the verifier scales 1:1 with
// the rule cards in cards.ts.
const MODE_CHECKLISTS: Record<string, string> = {
  ATOMIC: `- Exactly ONE sentence. No markdown, no bullets, no headings, no bold.
- Maximum 14 words.
- No preamble ("Sure", "Of course", "Happy to").`,

  CHAT: `- 1–3 short paragraphs, conversational. No H1/H2 headings.
- No "Executive Summary", no "Recommendations", no doc skeleton.
- Light **bold** only on key nouns/numbers. Never bold full sentences.
- No emojis. No filler openers.
- Lead with the answer.`,

  BRIEF: `- Leads with the answer in the first sentence (before any heading).
- Uses ONLY these section labels when present: ## Answer / ## Why / ## Next move.
- Omits empty or filler sections. A heading with one weak line is a fail.
- No H1 title, no italic subtitle, no Executive Summary, no Recommendations.
- Average sentence length ≤ 20 words.`,

  EXECUTION: `- Starts immediately at "## Done" with no prose preamble.
- Includes ## Result with concrete IDs / numbers / links.
- ## Blockers present ONLY if something actually failed or is pending.
- Reports tool failures honestly — does not claim success when a tool errored.
- No H1 title, no Executive Summary, no italic subtitle.`,

  DOCUMENT: `- Opens with a single "# H1 Title" line.
- Second line is an *italic one-line subtitle*.
- Includes a "## Executive Summary" as the first H2.
- Uses ## section headings for major sections.
- Ends with "## Recommendations" or "## Next Steps" followed by a single italic closing line.
- Uses tables for any 2+ option comparison present in the content.
- No emojis. No bolded full sentences. No filler openers.`,

  LONGFORM: `- It is a script / speech / essay / teleprompter — NOT a memo.
- NO "# H1 title", NO "## Executive Summary", NO "## Recommendations" sections.
- Reads aloud naturally with varied sentence length. Not a wall of clipped 5–8 word fragments.
- Meets the target word count within ±15% (target provided below if known).
- Uses scene paragraphs or voiceover formatting — NOT bullet lists.
- No emojis, no AI-tells ("In conclusion", "Let's dive in", "It's important to note").`,
};

export function getVerifierConfig(): VerifierConfig {
  const raw = (Deno.env.get("FORMAT_VERIFIER_MODE") || "shadow").toLowerCase();
  const opMode: VerifierOperatingMode =
    raw === "off" || raw === "active" ? raw : "shadow";
  const modes = (Deno.env.get("FORMAT_VERIFIER_MODES") || "DOCUMENT,LONGFORM")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const minChars = parseInt(
    Deno.env.get("FORMAT_VERIFIER_MIN_CHARS") || "200",
    10,
  );
  return {
    opMode,
    modes: new Set(modes),
    model: Deno.env.get("FORMAT_VERIFIER_MODEL") || DEFAULT_MODEL,
    minChars: Number.isFinite(minChars) ? minChars : 200,
  };
}

/** True when the verifier should run for this mode + text length. */
export function shouldVerify(
  cfg: VerifierConfig,
  mode: FormatMode | null | undefined,
  text: string,
): boolean {
  if (!mode || cfg.opMode === "off") return false;
  if (!cfg.modes.has(mode)) return false;
  if (!text || text.length < cfg.minChars) return false;
  if (!MODE_CHECKLISTS[mode]) return false;
  return true;
}

export async function verifyFormat(opts: {
  text: string;
  mode: FormatMode;
  targetWords?: number;
  apiKey: string;
  model?: string;
  repair?: boolean;
  timeoutMs?: number;
}): Promise<VerifyResult> {
  const start = Date.now();
  const model = opts.model || DEFAULT_MODEL;
  const checklist = MODE_CHECKLISTS[opts.mode];
  if (!checklist) {
    return {
      ok: true,
      issues: [],
      model,
      latencyMs: 0,
      skipped: "no-checklist",
    };
  }

  const targetLine = opts.targetWords
    ? `\nTarget word count: ~${opts.targetWords} (±15%).`
    : "";

  const repairLine = opts.repair
    ? `If ok=false, ALSO return "repaired": a full corrected version of the OUTPUT. Preserve every factual claim, name, number, link, and section. Only fix formatting violations from the rules above. Do not add, remove, or invent content.`
    : `Do NOT return any "repaired" field.`;

  const sys = `You are a strict but fair formatting verifier for an AI assistant called Ozlon.
You evaluate the assistant's OUTPUT against the rules for FormatMode = ${opts.mode}.

Return STRICT JSON (no prose, no markdown fence) with this shape:
{ "ok": boolean, "issues": string[]${opts.repair ? ', "repaired": string' : ''} }

Rules for ${opts.mode}:
${checklist}${targetLine}

Be concrete: each issue must name the specific rule violated (e.g.
"missing # H1 title on line 1", "uses ## Executive Summary inside a LONGFORM script",
"average sentence length exceeds 20 words"). List at most 6 issues. ${repairLine}`;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 8000,
  );

  try {
    const r = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `OUTPUT TO VERIFY:\n\n${opts.text}` },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
      signal: controller.signal,
    });

    if (!r.ok) {
      return {
        ok: true,
        issues: [],
        model,
        latencyMs: Date.now() - start,
        skipped: `http-${r.status}`,
      };
    }
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Some models wrap JSON in fences — strip and retry.
      const stripped = String(raw)
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "")
        .trim();
      try {
        parsed = JSON.parse(stripped);
      } catch {
        return {
          ok: true,
          issues: [],
          model,
          latencyMs: Date.now() - start,
          skipped: "parse-fail",
        };
      }
    }
    return {
      ok: parsed.ok === true,
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.slice(0, 6).map((x: unknown) => String(x))
        : [],
      repairedText:
        opts.repair && typeof parsed.repaired === "string" && parsed.repaired.length > 50
          ? parsed.repaired
          : undefined,
      model,
      latencyMs: Date.now() - start,
    };
  } catch (e) {
    return {
      ok: true,
      issues: [],
      model,
      latencyMs: Date.now() - start,
      skipped: `error:${(e as Error).name}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
