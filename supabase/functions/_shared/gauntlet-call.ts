// Thin wrapper that calls gauntlet-router /call and returns the same
// shape as model-registry.callWithFallback() so consumers can swap in
// without code changes.
import type { CallResult, AgentName, ChatMessage } from "./model-registry.ts";

export type RoutingMode = "speed" | "balanced" | "quality";

export interface GauntletCallOptions {
  agent: AgentName;
  messages: ChatMessage[];
  tools?: any[];
  tool_choice?: any;
  userId?: string | null;
  authHeader?: string | null;
  body?: Record<string, unknown>;
  modality?: "text" | "vision" | "image_gen" | "video_gen" | "audio";
  complexity?: "low" | "medium" | "high";
  latency_priority?: "fast" | "normal" | "relaxed";
  routing_mode?: RoutingMode;
}

// ─────────── Per-message classification ───────────
// Cheap heuristics that turn the actual user message into routing "needs"
// instead of using a static per-agent default. This is what makes the
// router pick different stones for different inputs.
function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return (m.content as any[])
        .map((p) => (typeof p === "string" ? p : p?.text ?? ""))
        .join(" ");
    }
  }
  return "";
}

function hasImageAttachment(messages: ChatMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const c: any = messages[i].content;
    if (Array.isArray(c)) {
      if (c.some((p: any) => p?.type === "image_url" || p?.image_url)) return true;
    }
  }
  return false;
}

function classifyMessage(messages: ChatMessage[]): {
  modality: "text" | "vision" | "image_gen" | "video_gen";
  complexity: "low" | "medium" | "high";
  latency_priority: "fast" | "normal" | "relaxed";
  context_size: number;
} {
  const text = lastUserText(messages).toLowerCase();
  const totalChars = messages.reduce((sum, m) => {
    const c: any = m.content;
    return sum + (typeof c === "string" ? c.length : JSON.stringify(c ?? "").length);
  }, 0);
  const ctxTokens = Math.ceil(totalChars / 4);

  // Modality
  let modality: "text" | "vision" | "image_gen" | "video_gen" = "text";
  if (/\b(generate|create|draw|make|render)\b.*\b(video|clip|animation)\b/.test(text)) {
    modality = "video_gen";
  } else if (/\b(generate|create|draw|make|render|design)\b.*\b(image|picture|illustration|logo|art|photo)\b/.test(text)) {
    modality = "image_gen";
  } else if (hasImageAttachment(messages) || /\b(this image|the photo|attached picture|see the image)\b/.test(text)) {
    modality = "vision";
  }

  // Complexity
  let complexity: "low" | "medium" | "high" = "medium";
  const hasCode = /```/.test(text) || /\bfunction\b|\bclass\b|=>/.test(text);
  const heavyVerbs = /\b(analyze|debug|refactor|architect|explain why|design|optimize|investigate|compare|evaluate)\b/.test(text);
  if (text.length > 500 || hasCode || heavyVerbs) complexity = "high";
  else if (text.length < 80 && !heavyVerbs) complexity = "low";

  // Latency
  let latency_priority: "fast" | "normal" | "relaxed" = "normal";
  if (text.length < 80) latency_priority = "fast";
  else if (text.length > 800 || complexity === "high") latency_priority = "relaxed";

  return { modality, complexity, latency_priority, context_size: ctxTokens };
}

// Map routing_mode → scorer overrides. User's budget choice wins over per-message classification.
function modeOverrides(mode?: RoutingMode): {
  cost_sensitivity?: "high" | "medium" | "low";
  latency_priority?: "fast" | "normal" | "relaxed";
  reason_tag?: string;
} {
  switch (mode) {
    case "speed":   return { cost_sensitivity: "high",   latency_priority: "fast",    reason_tag: "speed mode: cheapest capable" };
    case "quality": return { cost_sensitivity: "low",    latency_priority: "relaxed", reason_tag: "quality mode: best stone" };
    case "balanced":return { cost_sensitivity: "medium", reason_tag: "balanced mode" };
    default:        return {};
  }
}

// Map agent → modality/complexity hints for the router (fallback when classification yields nothing useful)
function deriveNeeds(agent: AgentName, messages: ChatMessage[], override?: Partial<GauntletCallOptions>) {
  const classified = classifyMessage(messages);
  const mo = modeOverrides(override?.routing_mode);
  return {
    modality: override?.modality ?? classified.modality,
    complexity: override?.complexity ?? classified.complexity,
    latency_priority: mo.latency_priority ?? override?.latency_priority ?? classified.latency_priority,
    context_size: classified.context_size,
    cost_sensitivity: mo.cost_sensitivity,
    routing_mode: override?.routing_mode,
    mode_reason: mo.reason_tag,
  };
}

export async function gauntletCall(opts: GauntletCallOptions): Promise<CallResult> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/gauntlet-router`;
  const start = Date.now();
  const needs = deriveNeeds(opts.agent, opts.messages, opts);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: opts.authHeader || `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "call",
        needs,
        messages: opts.messages,
        tools: opts.tools,
        node_type: opts.agent,
      }),
    });
    const latency = Date.now() - start;
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok || data?.error) {
      return {
        ok: false,
        status: resp.status,
        errorText: data?.error || data?.detail || `gauntlet ${resp.status}`,
        modelUsed: data?.model || "gauntlet-unknown",
        primaryModel: data?.model || "gauntlet-unknown",
        fallbackUsed: !!data?.fallback_used,
        latencyMs: latency,
        errorCode: `gauntlet_${resp.status}`,
      };
    }

    return {
      ok: true,
      status: 200,
      data: data.result, // { choices: [...], usage, model }
      modelUsed: data.model || data.stone || "gauntlet",
      primaryModel: data.model || data.stone || "gauntlet",
      fallbackUsed: !!data.fallback_used,
      latencyMs: latency,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      errorText: e instanceof Error ? e.message : String(e),
      modelUsed: "gauntlet-error",
      primaryModel: "gauntlet-error",
      fallbackUsed: false,
      latencyMs: Date.now() - start,
      errorCode: "network",
    };
  }
}

export function isGauntletEnabled(prefs?: { use_gauntlet?: boolean }): boolean {
  if (prefs?.use_gauntlet === false) return false;
  if (prefs?.use_gauntlet === true) return true;
  return Deno.env.get("USE_GAUNTLET") === "1";
}
