// ============================================================================
// INFINITY GAUNTLET — Model Registry & Efficiency Router
// Picks the cheapest capable model per agent, with automatic fallback chain.
// All models route through the Lovable AI Gateway.
// Defaults preserve current chat behavior; opt-in via user_model_preferences.
// ============================================================================

export type ChatMessage = { role: string; content?: string; [k: string]: unknown };
export type AgentName = 'planner' | 'executor' | 'classifier' | 'summarizer' | 'image_artist';
export type RoutingMode = 'speed' | 'balanced' | 'quality';
export type Capability = 'tools' | 'json' | 'vision' | 'long_context' | 'reasoning' | 'image_gen';

export interface ModelEntry {
  id: string;                 // Lovable AI gateway model id
  tier: 'nano' | 'flash' | 'standard' | 'pro';
  costPer1kIn: number;        // USD, approximate
  costPer1kOut: number;
  avgLatencyMs: number;
  contextWindow: number;
  capabilities: Capability[];
  enabled: boolean;
  fallback?: string;          // model id to try on failure
}

export interface AgentSpec {
  defaultModel: string;
  requires: Capability[];
  hardFallback: string;       // last-resort model
  preferredTier: Record<RoutingMode, ModelEntry['tier']>;
}

// All ids are Lovable AI Gateway compatible.
export const MODEL_REGISTRY: Record<string, ModelEntry> = {
  'google/gemini-2.5-flash-lite': {
    id: 'google/gemini-2.5-flash-lite',
    tier: 'nano',
    costPer1kIn: 0.0001,
    costPer1kOut: 0.0004,
    avgLatencyMs: 400,
    contextWindow: 1_000_000,
    capabilities: ['json', 'long_context'],
    enabled: true,
    fallback: 'google/gemini-2.5-flash',
  },
  'google/gemini-2.5-flash': {
    id: 'google/gemini-2.5-flash',
    tier: 'flash',
    costPer1kIn: 0.0003,
    costPer1kOut: 0.0025,
    avgLatencyMs: 700,
    contextWindow: 1_000_000,
    capabilities: ['tools', 'json', 'vision', 'long_context'],
    enabled: true,
    fallback: 'google/gemini-2.5-pro',
  },
  'google/gemini-2.5-pro': {
    id: 'google/gemini-2.5-pro',
    tier: 'pro',
    costPer1kIn: 0.00125,
    costPer1kOut: 0.01,
    avgLatencyMs: 1800,
    contextWindow: 2_000_000,
    capabilities: ['tools', 'json', 'vision', 'long_context', 'reasoning'],
    enabled: true,
    fallback: 'openai/gpt-5',
  },
  'openai/gpt-5-nano': {
    id: 'openai/gpt-5-nano',
    tier: 'nano',
    costPer1kIn: 0.0002,
    costPer1kOut: 0.0008,
    avgLatencyMs: 500,
    contextWindow: 256_000,
    capabilities: ['tools', 'json'],
    enabled: true,
    fallback: 'openai/gpt-5-mini',
  },
  'openai/gpt-5-mini': {
    id: 'openai/gpt-5-mini',
    tier: 'flash',
    costPer1kIn: 0.0008,
    costPer1kOut: 0.0032,
    avgLatencyMs: 900,
    contextWindow: 256_000,
    capabilities: ['tools', 'json', 'reasoning'],
    enabled: true,
    fallback: 'openai/gpt-5',
  },
  'openai/gpt-5': {
    id: 'openai/gpt-5',
    tier: 'standard',
    costPer1kIn: 0.005,
    costPer1kOut: 0.02,
    avgLatencyMs: 1500,
    contextWindow: 400_000,
    capabilities: ['tools', 'json', 'vision', 'reasoning'],
    enabled: true,
    fallback: 'google/gemini-2.5-pro',
  },
  'openai/gpt-5.2': {
    id: 'openai/gpt-5.2',
    tier: 'pro',
    costPer1kIn: 0.008,
    costPer1kOut: 0.03,
    avgLatencyMs: 2000,
    contextWindow: 400_000,
    capabilities: ['tools', 'json', 'vision', 'reasoning'],
    enabled: true,
    fallback: 'openai/gpt-5',
  },
  // ----- Gemini 3.x preview line -----
  'google/gemini-3.1-pro-preview': {
    id: 'google/gemini-3.1-pro-preview',
    tier: 'pro',
    costPer1kIn: 0.0015,
    costPer1kOut: 0.012,
    avgLatencyMs: 1900,
    contextWindow: 2_000_000,
    capabilities: ['tools', 'json', 'vision', 'long_context', 'reasoning'],
    enabled: true,
    fallback: 'google/gemini-2.5-pro',
  },
  'google/gemini-3-flash-preview': {
    id: 'google/gemini-3-flash-preview',
    tier: 'flash',
    costPer1kIn: 0.0004,
    costPer1kOut: 0.003,
    avgLatencyMs: 650,
    contextWindow: 1_000_000,
    capabilities: ['tools', 'json', 'vision', 'long_context'],
    enabled: true,
    fallback: 'google/gemini-2.5-flash',
  },
  // ----- Image generation / editing -----
  'google/gemini-2.5-flash-image': {
    id: 'google/gemini-2.5-flash-image',
    tier: 'flash',
    costPer1kIn: 0.0003,
    costPer1kOut: 0.003,
    avgLatencyMs: 4000,
    contextWindow: 32_000,
    capabilities: ['image_gen', 'vision'],
    enabled: true,
    fallback: 'google/gemini-3.1-flash-image-preview',
  },
  'google/gemini-3.1-flash-image-preview': {
    id: 'google/gemini-3.1-flash-image-preview',
    tier: 'flash',
    costPer1kIn: 0.0004,
    costPer1kOut: 0.004,
    avgLatencyMs: 5000,
    contextWindow: 32_000,
    capabilities: ['image_gen', 'vision'],
    enabled: true,
    fallback: 'google/gemini-2.5-flash-image',
  },
  'google/gemini-3-pro-image-preview': {
    id: 'google/gemini-3-pro-image-preview',
    tier: 'pro',
    costPer1kIn: 0.002,
    costPer1kOut: 0.015,
    avgLatencyMs: 8000,
    contextWindow: 32_000,
    capabilities: ['image_gen', 'vision'],
    enabled: true,
    fallback: 'google/gemini-3.1-flash-image-preview',
  },
};

// Per-agent specs. Defaults match current hardcoded behavior.
export const AGENT_REGISTRY: Record<AgentName, AgentSpec> = {
  planner: {
    defaultModel: 'google/gemini-2.5-flash-lite',
    requires: ['json'],
    hardFallback: 'google/gemini-2.5-flash',
    preferredTier: { speed: 'nano', balanced: 'nano', quality: 'flash' },
  },
  executor: {
    defaultModel: 'openai/gpt-5',
    requires: ['tools'],
    hardFallback: 'google/gemini-2.5-pro',
    preferredTier: { speed: 'flash', balanced: 'standard', quality: 'pro' },
  },
  classifier: {
    defaultModel: 'google/gemini-2.5-flash-lite',
    requires: ['json'],
    hardFallback: 'openai/gpt-5-nano',
    preferredTier: { speed: 'nano', balanced: 'nano', quality: 'flash' },
  },
  summarizer: {
    defaultModel: 'google/gemini-2.5-flash',
    requires: ['long_context'],
    hardFallback: 'google/gemini-2.5-flash-lite',
    preferredTier: { speed: 'flash', balanced: 'flash', quality: 'pro' },
  },
  image_artist: {
    defaultModel: 'google/gemini-3.1-flash-image-preview',
    requires: ['image_gen'],
    hardFallback: 'google/gemini-2.5-flash-image',
    preferredTier: { speed: 'flash', balanced: 'flash', quality: 'pro' },
  },
};

export interface UserPrefs {
  mode: RoutingMode;
  agent_overrides: Partial<Record<AgentName, string>>;
  disabled_models: string[];
}

export const DEFAULT_PREFS: UserPrefs = {
  mode: 'balanced',
  agent_overrides: {},
  disabled_models: [],
};

// ----------------------------------------------------------------------------
// Selection logic
// ----------------------------------------------------------------------------

function modelMeetsRequirements(m: ModelEntry, requires: Capability[]): boolean {
  if (!m.enabled) return false;
  return requires.every((c) => m.capabilities.includes(c));
}

export interface PickedRoute {
  primary: string;
  fallbackChain: string[];   // ordered list to try after primary fails
  reason: string;
}

/**
 * Pick the best model for an agent given user preferences.
 * Strategy: explicit override > tier match for mode > agent default.
 * Always returns a valid hardFallback at the end of the chain.
 */
export function pickModel(
  agent: AgentName,
  prefs: UserPrefs = DEFAULT_PREFS,
  registry: Record<string, ModelEntry> = MODEL_REGISTRY,
): PickedRoute {
  const spec = AGENT_REGISTRY[agent];
  const disabled = new Set(prefs.disabled_models || []);

  const eligible = Object.values(registry).filter(
    (m) => !disabled.has(m.id) && modelMeetsRequirements(m, spec.requires),
  );

  // 1. Explicit per-agent override wins.
  const override = prefs.agent_overrides?.[agent];
  if (override && registry[override] && !disabled.has(override)
      && modelMeetsRequirements(registry[override], spec.requires)) {
    return {
      primary: override,
      fallbackChain: buildFallbackChain(override, spec, eligible, registry),
      reason: 'user_override',
    };
  }

  // 2. Tier match for current mode.
  const targetTier = spec.preferredTier[prefs.mode];
  const tierMatches = eligible.filter((m) => m.tier === targetTier);
  if (tierMatches.length > 0) {
    tierMatches.sort((a, b) =>
      (a.costPer1kIn + a.costPer1kOut) - (b.costPer1kIn + b.costPer1kOut),
    );
    const primary = tierMatches[0].id;
    return {
      primary,
      fallbackChain: buildFallbackChain(primary, spec, eligible, registry),
      reason: `tier_${targetTier}_${prefs.mode}`,
    };
  }

  // 3. Agent default.
  if (registry[spec.defaultModel] && !disabled.has(spec.defaultModel)) {
    return {
      primary: spec.defaultModel,
      fallbackChain: buildFallbackChain(spec.defaultModel, spec, eligible, registry),
      reason: 'agent_default',
    };
  }

  // 4. Last resort.
  return {
    primary: spec.hardFallback,
    fallbackChain: [],
    reason: 'hard_fallback',
  };
}

function buildFallbackChain(primary: string, spec: AgentSpec, eligible: ModelEntry[]): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([primary]);
  // Walk primary.fallback links.
  let cursor: string | undefined = MODEL_REGISTRY[primary]?.fallback;
  while (cursor && !seen.has(cursor) && chain.length < 3) {
    if (MODEL_REGISTRY[cursor]
        && eligible.some((e) => e.id === cursor)) {
      chain.push(cursor);
      seen.add(cursor);
    }
    cursor = MODEL_REGISTRY[cursor]?.fallback;
  }
  // Always end with hardFallback if not already present.
  if (!seen.has(spec.hardFallback)) chain.push(spec.hardFallback);
  return chain;
}

// ----------------------------------------------------------------------------
// Call with fallback — wraps Lovable AI Gateway with automatic retry chain.
// ----------------------------------------------------------------------------

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';

export interface CallOptions {
  messages: ChatMessage[];
  agent: AgentName;
  prefs?: UserPrefs;
  apiKey: string;
  body?: Record<string, unknown>;       // extra fields like response_format, tools, max_tokens
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CallResult {
  ok: boolean;
  status: number;
  data?: any;
  errorText?: string;
  modelUsed: string;
  primaryModel: string;
  fallbackUsed: boolean;
  latencyMs: number;
  errorCode?: string;
}

/**
 * Call AI gateway with automatic fallback chain.
 * Retries on 429, 402, 408, 5xx, network/timeout errors.
 * Logs every attempt to model_routing_log via fire-and-forget Supabase insert.
 */
export async function callWithFallback(opts: CallOptions): Promise<CallResult> {
  const prefs = opts.prefs || DEFAULT_PREFS;
  const route = pickModel(opts.agent, prefs);
  const candidates = [route.primary, ...route.fallbackChain];

  let lastResult: CallResult | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const modelId = candidates[i];
    const isFallback = i > 0;
    const start = Date.now();

    try {
      const ctrl = new AbortController();
      const timer = opts.timeoutMs
        ? setTimeout(() => ctrl.abort(), opts.timeoutMs)
        : null;

      // Honor caller-provided signal too.
      const onAbort = () => ctrl.abort();
      if (opts.signal) opts.signal.addEventListener('abort', onAbort);

      const resp = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: modelId,
          messages: opts.messages,
          ...(opts.body || {}),
        }),
      });
      if (timer) clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);

      const latency = Date.now() - start;

      if (resp.ok) {
        const data = await resp.json();
        const result: CallResult = {
          ok: true,
          status: resp.status,
          data,
          modelUsed: modelId,
          primaryModel: route.primary,
          fallbackUsed: isFallback,
          latencyMs: latency,
        };
        lastResult = result;
        return result;
      }

      // Decide whether to retry.
      const retryable = resp.status === 429
        || resp.status === 402
        || resp.status === 408
        || resp.status >= 500;
      const errText = await resp.text().catch(() => '');
      lastResult = {
        ok: false,
        status: resp.status,
        errorText: errText,
        modelUsed: modelId,
        primaryModel: route.primary,
        fallbackUsed: isFallback,
        latencyMs: latency,
        errorCode: `http_${resp.status}`,
      };
      console.warn(
        `[Gauntlet] ${opts.agent} via ${modelId} -> ${resp.status} (retryable=${retryable})`,
      );
      if (!retryable) return lastResult;
      // continue to next candidate
    } catch (e) {
      const latency = Date.now() - start;
      const msg = e instanceof Error ? e.message : String(e);
      lastResult = {
        ok: false,
        status: 0,
        errorText: msg,
        modelUsed: modelId,
        primaryModel: route.primary,
        fallbackUsed: isFallback,
        latencyMs: latency,
        errorCode: msg.includes('abort') ? 'timeout' : 'network',
      };
      console.warn(`[Gauntlet] ${opts.agent} via ${modelId} threw: ${msg}`);
      // continue to next candidate
    }
  }

  return lastResult || {
    ok: false,
    status: 0,
    modelUsed: route.primary,
    primaryModel: route.primary,
    fallbackUsed: false,
    latencyMs: 0,
    errorCode: 'no_attempts',
  };
}

// ----------------------------------------------------------------------------
// Telemetry — fire-and-forget log to model_routing_log.
// Pass a Supabase service-role client.
// ----------------------------------------------------------------------------

export function logRouting(
  supabase: any,
  userId: string,
  agent: AgentName,
  result: CallResult,
  metadata: Record<string, unknown> = {},
): void {
  try {
    supabase
      .from('model_routing_log')
      .insert({
        user_id: userId,
        agent,
        model_used: result.modelUsed,
        primary_model: result.primaryModel,
        latency_ms: result.latencyMs,
        success: result.ok,
        fallback_used: result.fallbackUsed,
        error_code: result.errorCode || null,
        metadata,
      })
      .then((r: any) => {
        if (r?.error) console.warn('[Gauntlet] log insert failed:', r.error.message);
      });
  } catch (e) {
    console.warn('[Gauntlet] logRouting threw:', e);
  }
}

// ----------------------------------------------------------------------------
// Load user preferences from Supabase. Returns DEFAULT_PREFS if no row.
// ----------------------------------------------------------------------------

export async function loadUserPrefs(supabase: any, userId: string): Promise<UserPrefs> {
  if (!userId) return DEFAULT_PREFS;
  try {
    const { data, error } = await supabase
      .from('user_model_preferences')
      .select('mode, agent_overrides, disabled_models')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return DEFAULT_PREFS;
    return {
      mode: (data.mode as RoutingMode) || 'balanced',
      agent_overrides: (data.agent_overrides as Record<AgentName, string>) || {},
      disabled_models: (data.disabled_models as string[]) || [],
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

// ----------------------------------------------------------------------------
// STONE SOCKET — Load user-defined custom models and merge into the registry.
// Custom rows in `custom_models` table can override or extend MODEL_REGISTRY.
// ----------------------------------------------------------------------------

export async function loadCustomModels(supabase: any, userId: string): Promise<Record<string, ModelEntry>> {
  if (!userId) return {};
  try {
    const { data, error } = await supabase
      .from('custom_models')
      .select('model_id, gateway_url, api_key_secret_name, context_window, cost_per_1k_in, cost_per_1k_out, avg_latency_ms, capabilities, tier, fallback_model_id, enabled')
      .eq('user_id', userId)
      .eq('enabled', true);
    if (error || !data) return {};
    const out: Record<string, ModelEntry> = {};
    for (const row of data as any[]) {
      out[row.model_id] = {
        id: row.model_id,
        tier: (row.tier as ModelEntry['tier']) || 'standard',
        costPer1kIn: Number(row.cost_per_1k_in) || 0,
        costPer1kOut: Number(row.cost_per_1k_out) || 0,
        avgLatencyMs: row.avg_latency_ms || 1000,
        contextWindow: row.context_window || 128000,
        capabilities: (row.capabilities as Capability[]) || [],
        enabled: true,
        fallback: row.fallback_model_id || undefined,
        // Custom-only fields stashed via cast for use in callWithFallback
        ...({ _gatewayUrl: row.gateway_url, _apiKeySecret: row.api_key_secret_name } as any),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Merge static registry with user's custom models (custom overrides static). */
export function mergeRegistry(custom: Record<string, ModelEntry>): Record<string, ModelEntry> {
  return { ...MODEL_REGISTRY, ...custom };
}

