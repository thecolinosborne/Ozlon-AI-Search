// Thin wrapper that calls gauntlet-router /call and returns the same
// shape as model-registry.callWithFallback() so consumers can swap in
// without code changes.
import type { CallResult, AgentName, ChatMessage } from "./model-registry.ts";

export interface GauntletCallOptions {
  agent: AgentName;
  messages: ChatMessage[];
  tools?: any[];
  userId?: string | null;
  authHeader?: string | null;
  body?: Record<string, unknown>;
  modality?: "text" | "vision" | "image_gen" | "video_gen" | "audio";
  complexity?: "low" | "medium" | "high";
  latency_priority?: "fast" | "normal" | "relaxed";
}

// Map agent → modality/complexity hints for the router
function deriveNeeds(agent: AgentName, override?: Partial<GauntletCallOptions>) {
  const base: Record<AgentName, { modality: string; complexity: string; latency_priority: string }> = {
    planner:        { modality: "text",      complexity: "low",    latency_priority: "fast" },
    executor:       { modality: "text",      complexity: "high",   latency_priority: "normal" },
    classifier:     { modality: "text",      complexity: "low",    latency_priority: "fast" },
    summarizer:     { modality: "text",      complexity: "medium", latency_priority: "normal" },
    image_artist:   { modality: "image_gen", complexity: "medium", latency_priority: "relaxed" },
    video_director: { modality: "video_gen", complexity: "medium", latency_priority: "relaxed" },
  };
  const b = base[agent] ?? base.executor;
  return {
    modality: override?.modality ?? b.modality,
    complexity: override?.complexity ?? b.complexity,
    latency_priority: override?.latency_priority ?? b.latency_priority,
  };
}

export async function gauntletCall(opts: GauntletCallOptions): Promise<CallResult> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/gauntlet-router`;
  const start = Date.now();
  const needs = deriveNeeds(opts.agent, opts);

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
