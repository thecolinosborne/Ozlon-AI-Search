// AI Gauntlet Router — picks the best "stone" (provider) for each AI call
// Actions: select | call | verify | log | list
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─────────── Stone capability matrix ───────────
type Stone = {
  provider: "lovable" | "openai" | "gemini" | "anthropic" | "higgsfield";
  defaultModel: string;
  reasoning: number;   // 0-10
  vision: number;      // 0-10
  image: number;       // 0-10
  video: number;       // 0-10
  speed: number;       // 0-10
  cost: number;        // 1-4 ($ tier)
  maxCtx: number;
};

const STONES: Record<string, Stone> = {
  // Lovable gateway is chat-only — it CANNOT produce images or videos. Score 0
  // so the scorer never wastes a turn picking it for a guaranteed failure.
  lovable:    { provider: "lovable",    defaultModel: "google/gemini-3-flash-preview", reasoning: 8,  vision: 7,  image: 0,  video: 0, speed: 7, cost: 1, maxCtx: 1_000_000 },
  openai:     { provider: "openai",     defaultModel: "gpt-5",                          reasoning: 10, vision: 9,  image: 0,  video: 0, speed: 6, cost: 4, maxCtx: 400_000 },
  gemini:     { provider: "gemini",     defaultModel: "gemini-2.5-flash",               reasoning: 9,  vision: 10, image: 10, video: 8, speed: 9, cost: 2, maxCtx: 2_000_000 },
  anthropic:  { provider: "anthropic",  defaultModel: "claude-sonnet-4-5",              reasoning: 9,  vision: 8,  image: 0,  video: 0, speed: 7, cost: 3, maxCtx: 200_000 },
  higgsfield: { provider: "higgsfield", defaultModel: "higgsfield-ai/dop/standard",     reasoning: 0,  vision: 0,  image: 9,  video: 10, speed: 6, cost: 2, maxCtx: 32_000 },
};

const SYSTEM_STONES = ["lovable", "openai", "gemini", "higgsfield"] as const;

// ─────────── Scoring function ───────────
type Needs = {
  modality?: "text" | "vision" | "image_gen" | "video_gen" | "audio";
  complexity?: "low" | "medium" | "high";
  latency_priority?: "fast" | "normal" | "relaxed";
  context_size?: number;
  cost_sensitivity?: "low" | "medium" | "high";
};

export function pickStone(
  needs: Needs,
  activeProviders: string[],
): { stone: Stone; reason: string; fallbacks: Stone[] } | null {
  const candidates = activeProviders
    .map((p) => STONES[p])
    .filter(Boolean);

  if (candidates.length === 0) return null;

  const modality = needs.modality ?? "text";
  const complexity = needs.complexity ?? "medium";
  const latency = needs.latency_priority ?? "normal";
  const ctxSize = needs.context_size ?? 0;
  const costSens = needs.cost_sensitivity ?? "medium";

  const scored = candidates.map((s) => {
    let score = 0;
    const why: string[] = [];

    if (modality === "video_gen") {
      score += s.video * 3;
      if (s.video > 0) why.push(`video ${s.video}/10`);
      else score -= 50; // disqualify non-video stones
    } else if (modality === "image_gen") {
      score += s.image * 3;
      if (s.image > 0) why.push(`image ${s.image}/10`);
      else score -= 50;
    } else if (modality === "vision") {
      score += s.vision * 3;
      why.push(`vision ${s.vision}/10`);
    } else {
      score += s.reasoning * 1.5;
      // text-only stones (no reasoning) shouldn't pick higgsfield
      if (s.reasoning === 0) score -= 100;
    }

    const wantReason = complexity === "high" ? 9 : complexity === "medium" ? 6 : 3;
    score += (10 - Math.abs(s.reasoning - wantReason)) * 2;
    if (complexity === "high") why.push(`heavy reasoning`);

    const wantSpeed = latency === "fast" ? 10 : latency === "normal" ? 7 : 4;
    score += 10 - Math.abs(s.speed - wantSpeed);
    if (latency === "fast") why.push(`fast`);

    const costMultiplier = costSens === "high" ? 3 : costSens === "medium" ? 1 : 0.3;
    score -= s.cost * costMultiplier;
    if (costSens === "high" && s.cost <= 2) why.push(`cheap`);

    if (ctxSize > s.maxCtx) {
      score -= 100;
      why.push(`ctx overflow`);
    }

    return { stone: s, score, why: why.join(", ") };
  });

  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];
  const fallbacks = scored.slice(1).filter((x) => x.score > -50).map((x) => x.stone);

  return {
    stone: winner.stone,
    reason: `${winner.stone.provider}: ${winner.why || "best fit"}`,
    fallbacks,
  };
}

// ─────────── Provider drivers (key passed in, never read env directly) ───────────
async function callLovable(model: string, messages: any[], key: string, tools?: any[], toolChoice?: any): Promise<any> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, ...(tools && { tools }), ...(toolChoice && { tool_choice: toolChoice }) }),
  });
  if (!res.ok) throw new Error(`Lovable ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function callOpenAI(model: string, messages: any[], key: string, tools?: any[], toolChoice?: any): Promise<any> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, ...(tools && { tools }), ...(toolChoice && { tool_choice: toolChoice }) }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function callGemini(model: string, messages: any[], key: string, tools?: any[], toolChoice?: any): Promise<any> {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      ...(tools && { tools }),
      ...(toolChoice && { tool_choice: toolChoice }),
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function callAnthropic(model: string, messages: any[], key: string): Promise<any> {
  const system = messages.find((m) => m.role === "system")?.content;
  const filtered = messages.filter((m) => m.role !== "system");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 4096, system, messages: filtered }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    choices: [{ message: { role: "assistant", content: data.content?.[0]?.text ?? "" } }],
    usage: data.usage,
    model: data.model,
  };
}

// Real Higgsfield dispatch: forward to higgsfield edge function
async function callHiggsfield(needs: Needs, messages: any[], authHeader?: string): Promise<any> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const prompt = messages
    .filter((m: any) => m.role === "user" || m.role === "system")
    .map((m: any) => typeof m.content === "string" ? m.content : JSON.stringify(m.content))
    .join("\n");

  const action = needs.modality === "video_gen" ? "generate_video" : "generate_image";
  const params: Record<string, unknown> = needs.modality === "video_gen"
    ? { image_url: (messages.find((m: any) => m.image_url) as any)?.image_url, prompt, duration: 5 }
    : { prompt, aspect_ratio: "16:9", resolution: "720p" };

  const res = await fetch(`${supabaseUrl}/functions/v1/higgsfield`, {
    method: "POST",
    headers: {
      Authorization: authHeader || `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
    },
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) throw new Error(`Higgsfield ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "higgsfield failed");

  const data = json.data;
  const url = data?.url || data?.video_url || data?.image_url || "";
  const requestId = data?.request_id || data?.id || "";
  const content = url || `Higgsfield job started: ${requestId}`;
  return {
    choices: [{ message: { role: "assistant", content }, finish_reason: url ? "stop" : "in_progress" }],
    model: action === "generate_video" ? "higgsfield-video" : "higgsfield-image",
    higgsfield: { request_id: requestId, url },
  };
}

const ENV_KEY_MAP: Record<string, string> = {
  lovable: "LOVABLE_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  higgsfield: "HIGGSFIELD_API_KEY",
};

// Look up the user's personal key for a platform from custom_models (stored as inline:<key>)
async function getUserKey(admin: any, userId: string | null, platformId: string): Promise<string | null> {
  if (!userId) return null;
  const { data } = await admin
    .from("custom_models")
    .select("api_key_secret_name, metadata")
    .eq("user_id", userId)
    .eq("metadata->>platform_id", platformId)
    .limit(1)
    .maybeSingle();
  const secret = data?.api_key_secret_name as string | undefined;
  if (secret && secret.startsWith("inline:")) return secret.slice("inline:".length);
  return null;
}

// Resolve key with precedence: user > env. Returns { key, source }
async function resolveKey(admin: any, userId: string | null, provider: string): Promise<{ key: string | null; source: "user" | "system" | "none" }> {
  const userKey = await getUserKey(admin, userId, provider);
  if (userKey) return { key: userKey, source: "user" };
  const envKey = Deno.env.get(ENV_KEY_MAP[provider] || "");
  if (envKey) return { key: envKey, source: "system" };
  return { key: null, source: "none" };
}

async function dispatch(provider: string, model: string, messages: any[], tools: any[] | undefined, needs: Needs | undefined, authHeader: string | undefined, key: string, toolChoice?: any) {
  switch (provider) {
    case "lovable":   return callLovable(model, messages, key, tools, toolChoice);
    case "openai":    return callOpenAI(model, messages, key, tools, toolChoice);
    case "gemini":    return callGemini(model, messages, key, tools, toolChoice);
    case "anthropic": return callAnthropic(model, messages, key);
    case "higgsfield": return callHiggsfield(needs ?? {}, messages, authHeader);
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

// ─────────── Verify each provider has a working key (returns keyTail + source) ───────────
async function verifyProvider(
  provider: string,
  admin: any,
  userId: string | null,
): Promise<{ ok: boolean; error?: string; keyTail?: string; source?: "user" | "system" | "none" }> {
  try {
    const stone = STONES[provider];
    if (!stone) return { ok: false, error: "unknown provider" };

    const resolved = await resolveKey(admin, userId, provider);
    if (!resolved.key) return { ok: false, error: "no API key", source: "none" };
    const keyTail = resolved.key.length >= 4 ? resolved.key.slice(-4) : resolved.key;

    if (provider === "higgsfield") {
      // Higgsfield needs both API key and APP ID (APP ID env-only for now)
      const appId = Deno.env.get("HIGGSFIELD_APP_ID");
      if (!appId) return { ok: false, error: "missing HIGGSFIELD_APP_ID", source: resolved.source, keyTail };
      return { ok: true, keyTail, source: resolved.source };
    }

    // Light ping for chat-capable providers
    await dispatch(provider, stone.defaultModel, [{ role: "user", content: "ping" }], undefined, undefined, undefined, resolved.key);
    return { ok: true, keyTail, source: resolved.source };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────── Handler ───────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, ...payload } = await req.json();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    let userId: string | null = null;
    if (authHeader.startsWith("Bearer ")) {
      const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await sb.auth.getUser();
      userId = data.user?.id ?? null;
    }

    const admin = createClient(supabaseUrl, serviceKey);

    if (action === "select") {
      const { needs } = payload;
      const active = await getActiveProviders(admin, userId);
      const result = pickStone(needs ?? {}, active);
      if (!result) return json({ error: "no active stones" }, 400);
      return json({
        provider: result.stone.provider,
        model: result.stone.defaultModel,
        reason: result.reason,
        fallbacks: result.fallbacks.map((s) => ({ provider: s.provider, model: s.defaultModel })),
      });
    }

    if (action === "call") {
      const { needs, messages, tools, run_id, node_type } = payload;
      const active = await getActiveProviders(admin, userId);
      let picked = pickStone(needs ?? {}, active);
      if (!picked) return json({ error: "no active stones" }, 400);

      // ── Brain evolution: bias selection for signals-* node_types based on
      //    this user's historical outcomes (written by signals-tune as
      //    wisdom_memories.memory_type='brain_routing_pref').
      let evolutionReason: string | null = null;
      if (userId && typeof node_type === "string" && node_type.startsWith("signals-")) {
        try {
          const { data: prefRow } = await admin
            .from("wisdom_memories")
            .select("content")
            .eq("user_id", userId)
            .eq("memory_type", "brain_routing_pref")
            .maybeSingle();
          const prefMap = prefRow?.content ? JSON.parse(prefRow.content as string) : null;
          const nodePref = prefMap?.[node_type];
          if (nodePref && (nodePref.preferred_stones?.length || nodePref.avoid?.length)) {
            const preferred: string[] = nodePref.preferred_stones ?? [];
            const avoid: string[] = nodePref.avoid ?? [];
            // Reorder: preferred first (in order), then current pick + fallbacks
            // minus avoided ones. Avoided can still be used as last-resort fallback.
            const chain = [picked.stone, ...picked.fallbacks];
            const reordered: typeof chain = [];
            for (const p of preferred) {
              const found = chain.find((s) => s.provider === p);
              if (found && !reordered.includes(found)) reordered.push(found);
            }
            for (const s of chain) {
              if (avoid.includes(s.provider)) continue;
              if (!reordered.includes(s)) reordered.push(s);
            }
            for (const s of chain) {
              if (!reordered.includes(s)) reordered.push(s); // avoided as last resort
            }
            if (reordered.length > 0 && reordered[0] !== picked.stone) {
              evolutionReason = `evolved: ${nodePref.reason}`;
              picked = {
                stone: reordered[0],
                fallbacks: reordered.slice(1),
                reason: `${evolutionReason} (was ${picked.stone.provider})`,
              };
            }
          }
        } catch (e) {
          console.warn("[gauntlet] brain_routing_pref skipped:", e instanceof Error ? e.message : e);
        }
      }

      const chain = [picked.stone, ...picked.fallbacks];
      let lastError: string | null = null;
      let fallbackUsed = false;

      for (const stone of chain) {
        const start = Date.now();
        try {
          const resolved = await resolveKey(admin, userId, stone.provider);
          if (!resolved.key && stone.provider !== "higgsfield") {
            throw new Error(`no key for ${stone.provider}`);
          }
          const result = await dispatch(stone.provider, stone.defaultModel, messages, tools, needs, authHeader, resolved.key ?? "", payload.tool_choice);
          const latency = Date.now() - start;
          if (userId) {
            await admin.from("gauntlet_routing_log").insert({
              user_id: userId, run_id, node_type,
              modality: needs?.modality, complexity: needs?.complexity,
              chosen_stone: stone.provider, chosen_model: stone.defaultModel,
              reason: picked.reason, fallback_used: fallbackUsed,
              latency_ms: latency, success: true,
              metadata: { key_source: resolved.source },
            });
          }
          return json({
            result, stone: stone.provider, model: stone.defaultModel,
            reason: picked.reason, fallback_used: fallbackUsed,
          });
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          fallbackUsed = true;
          console.error(`[gauntlet] ${stone.provider} failed:`, lastError);
        }
      }

      if (userId) {
        await admin.from("gauntlet_routing_log").insert({
          user_id: userId, run_id, node_type,
          modality: needs?.modality, complexity: needs?.complexity,
          chosen_stone: chain[0].provider, fallback_used: true,
          success: false, metadata: { error: lastError },
        });
      }
      return json({ error: "all stones failed", detail: lastError }, 502);
    }

    if (action === "verify") {
      const results: Record<string, any> = {};
      for (const p of SYSTEM_STONES) {
        results[p] = await verifyProvider(p, admin, userId);
      }
      if (userId) {
        for (const [provider, res] of Object.entries(results)) {
          const r = res as any;
          await admin.from("ai_providers").upsert({
            user_id: userId,
            provider,
            status: r.ok ? "active" : "error",
            last_verified_at: new Date().toISOString(),
            last_error: r.error ?? null,
            capabilities: { ...STONES[provider], keyTail: r.keyTail ?? null, source: r.source ?? "none" },
          }, { onConflict: "user_id,provider" });
        }
      }
      return json({ providers: results });
    }

    if (action === "list") {
      if (!userId) return json({ providers: [] });
      let { data } = await admin
        .from("ai_providers")
        .select("*")
        .eq("user_id", userId)
        .order("priority", { ascending: true });

      // Auto-verify any system STONE missing OR stale (error/missing keyTail) so rows self-heal.
      // Also re-verify if the user just connected/disconnected a personal key (source mismatch).
      const existingMap = new Map((data ?? []).map((r: any) => [r.provider, r]));
      const toVerify: string[] = [];
      for (const p of SYSTEM_STONES) {
        const row = existingMap.get(p);
        const userKey = await getUserKey(admin, userId, p);
        const hasEnv = !!Deno.env.get(ENV_KEY_MAP[p]);
        const recordedSource = (row?.capabilities as any)?.source;
        const expectedSource = userKey ? "user" : (hasEnv ? "system" : "none");
        if (!row) { toVerify.push(p); continue; }
        const stale = (row.status === "error" && (userKey || hasEnv)) || !((row.capabilities as any)?.keyTail);
        const sourceMismatch = recordedSource !== expectedSource;
        if (stale || sourceMismatch) toVerify.push(p);
      }
      if (toVerify.length > 0) {
        for (const p of toVerify) {
          const r = await verifyProvider(p, admin, userId);
          await admin.from("ai_providers").upsert({
            user_id: userId,
            provider: p,
            status: r.ok ? "active" : "error",
            last_verified_at: new Date().toISOString(),
            last_error: r.error ?? null,
            capabilities: { ...STONES[p], keyTail: r.keyTail ?? null, source: r.source ?? "none" },
          }, { onConflict: "user_id,provider" });
        }
        const refetched = await admin
          .from("ai_providers")
          .select("*")
          .eq("user_id", userId)
          .order("priority", { ascending: true });
        data = refetched.data;
      }

      return json({ providers: data ?? [], stones: STONES });
    }

    if (action === "recent_decisions") {
      if (!userId) return json({ decisions: [] });
      const limit = Math.min(Math.max(Number(payload.limit) || 20, 1), 100);
      const { data } = await admin
        .from("gauntlet_routing_log")
        .select("id, chosen_stone, chosen_model, modality, complexity, reason, fallback_used, latency_ms, success, created_at, metadata")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      return json({ decisions: data ?? [] });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("[gauntlet-router] error:", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

async function getActiveProviders(admin: any, userId: string | null): Promise<string[]> {
  if (!userId) return ["lovable"];
  const { data } = await admin
    .from("ai_providers")
    .select("provider, status")
    .eq("user_id", userId)
    .eq("status", "active");
  const active = (data ?? []).map((r: any) => r.provider);
  if (!active.includes("lovable") && Deno.env.get("LOVABLE_API_KEY")) {
    active.push("lovable");
  }
  // Also include any provider with system key set, even if user has no row yet
  const sysKeys: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
    higgsfield: "HIGGSFIELD_API_KEY",
  };
  for (const [p, env] of Object.entries(sysKeys)) {
    if (!active.includes(p) && Deno.env.get(env)) active.push(p);
  }
  return active;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
