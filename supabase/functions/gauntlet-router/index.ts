// AI Gauntlet Router — picks the best "stone" (provider) for each AI call
// Actions: select | call | verify | log
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─────────── Stone capability matrix ───────────
type Stone = {
  provider: "lovable" | "openai" | "gemini" | "anthropic";
  defaultModel: string;
  reasoning: number;   // 0-10
  vision: number;      // 0-10
  image: number;       // 0-10
  speed: number;       // 0-10
  cost: number;        // 1-4 ($ tier)
  maxCtx: number;
};

const STONES: Record<string, Stone> = {
  lovable: { provider: "lovable", defaultModel: "google/gemini-3-flash-preview", reasoning: 8, vision: 7, image: 9, speed: 7, cost: 1, maxCtx: 1_000_000 },
  openai: { provider: "openai", defaultModel: "gpt-5", reasoning: 10, vision: 9, image: 0, speed: 6, cost: 4, maxCtx: 400_000 },
  gemini: { provider: "gemini", defaultModel: "gemini-2.5-flash", reasoning: 9, vision: 10, image: 10, speed: 9, cost: 2, maxCtx: 2_000_000 },
  anthropic: { provider: "anthropic", defaultModel: "claude-sonnet-4-5", reasoning: 9, vision: 8, image: 0, speed: 7, cost: 3, maxCtx: 200_000 },
};

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
    let why: string[] = [];

    // Modality fit (×3 weight)
    if (modality === "video_gen") {
      score += s.video * 3;
      if (s.video > 0) why.push(`video-capable (${s.video}/10)`);
    } else if (modality === "image_gen") {
      score += s.image * 3;
      if (s.image > 0) why.push(`image-capable (${s.image}/10)`);
    } else if (modality === "vision") {
      score += s.vision * 3;
      why.push(`vision ${s.vision}/10`);
    } else {
      score += s.reasoning * 1.5; // text uses reasoning as proxy
    }

    // Reasoning fit (×2)
    const wantReason = complexity === "high" ? 9 : complexity === "medium" ? 6 : 3;
    score += (10 - Math.abs(s.reasoning - wantReason)) * 2;
    if (complexity === "high") why.push(`heavy reasoning`);

    // Speed fit (×1)
    const wantSpeed = latency === "fast" ? 10 : latency === "normal" ? 7 : 4;
    score += 10 - Math.abs(s.speed - wantSpeed);
    if (latency === "fast") why.push(`fast response needed`);

    // Cost penalty
    const costMultiplier = costSens === "high" ? 3 : costSens === "medium" ? 1 : 0.3;
    score -= s.cost * costMultiplier;
    if (costSens === "high" && s.cost <= 2) why.push(`cost-efficient`);

    // Context overflow penalty
    if (ctxSize > s.maxCtx) {
      score -= 100;
      why.push(`context overflow`);
    }

    return { stone: s, score, why: why.join(", ") };
  });

  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];
  const fallbacks = scored.slice(1).map((x) => x.stone);

  return {
    stone: winner.stone,
    reason: `Picked ${winner.stone.provider}: ${winner.why || "best overall fit"}`,
    fallbacks,
  };
}

// ─────────── Provider drivers ───────────
async function callLovable(model: string, messages: any[], tools?: any[]): Promise<any> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, ...(tools && { tools }) }),
  });
  if (!res.ok) throw new Error(`Lovable ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function callOpenAI(model: string, messages: any[], tools?: any[]): Promise<any> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, ...(tools && { tools }) }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function callGemini(model: string, messages: any[]): Promise<any> {
  // Use OpenAI-compatible endpoint
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("GEMINI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function callAnthropic(model: string, messages: any[]): Promise<any> {
  const system = messages.find((m) => m.role === "system")?.content;
  const filtered = messages.filter((m) => m.role !== "system");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 4096, system, messages: filtered }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  // Normalize to OpenAI-ish shape
  return {
    choices: [{ message: { role: "assistant", content: data.content?.[0]?.text ?? "" } }],
    usage: data.usage,
    model: data.model,
  };
}

async function callHiggsfield(prompt: string): Promise<any> {
  const apiKey = Deno.env.get("HIGGSFIELD_API_KEY");
  if (!apiKey) throw new Error("HIGGSFIELD_API_KEY missing");
  // Lightweight ping — Higgsfield is a video/image gen service, no chat endpoint.
  // For verify we just confirm the key exists; real generation goes through the higgsfield edge function.
  return {
    choices: [{ message: { role: "assistant", content: `[higgsfield] queued: ${prompt}` } }],
    model: "higgsfield-video-v1",
  };
}

async function dispatch(provider: string, model: string, messages: any[], tools?: any[]) {
  switch (provider) {
    case "lovable": return callLovable(model, messages, tools);
    case "openai": return callOpenAI(model, messages, tools);
    case "gemini": return callGemini(model, messages);
    case "anthropic": return callAnthropic(model, messages);
    case "higgsfield": {
      const prompt = messages.map((m: any) => m.content).join("\n");
      return callHiggsfield(prompt);
    }
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

// ─────────── Verify each provider has a working key ───────────
async function verifyProvider(provider: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const stone = STONES[provider];
    if (!stone) return { ok: false, error: "unknown provider" };

    // Lovable is always considered active if LOVABLE_API_KEY exists
    if (provider === "lovable") {
      return { ok: !!Deno.env.get("LOVABLE_API_KEY") };
    }

    const keyMap: Record<string, string> = {
      openai: "OPENAI_API_KEY",
      gemini: "GEMINI_API_KEY",
      anthropic: "ANTHROPIC_API_KEY",
      higgsfield: "HIGGSFIELD_API_KEY",
    };
    const key = Deno.env.get(keyMap[provider]);
    if (!key) return { ok: false, error: "no API key" };

    // Higgsfield: key presence is enough (no cheap ping endpoint)
    if (provider === "higgsfield") return { ok: true };

    // Light ping
    await dispatch(provider, stone.defaultModel, [{ role: "user", content: "ping" }]);
    return { ok: true };
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

    // Resolve user from JWT (best-effort)
    let userId: string | null = null;
    if (authHeader.startsWith("Bearer ")) {
      const sb = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await sb.auth.getUser();
      userId = data.user?.id ?? null;
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // ── ACTION: select ──
    if (action === "select") {
      const { needs } = payload;
      const active = await getActiveProviders(admin, userId);
      const result = pickStone(needs ?? {}, active);
      if (!result) {
        return json({ error: "no active stones" }, 400);
      }
      return json({
        provider: result.stone.provider,
        model: result.stone.defaultModel,
        reason: result.reason,
        fallbacks: result.fallbacks.map((s) => ({ provider: s.provider, model: s.defaultModel })),
      });
    }

    // ── ACTION: call ── (select + dispatch + log + auto-fallback)
    if (action === "call") {
      const { needs, messages, tools, run_id, node_type } = payload;
      const active = await getActiveProviders(admin, userId);
      const picked = pickStone(needs ?? {}, active);
      if (!picked) return json({ error: "no active stones" }, 400);

      const chain = [picked.stone, ...picked.fallbacks];
      let lastError: string | null = null;
      let fallbackUsed = false;

      for (const stone of chain) {
        const start = Date.now();
        try {
          const result = await dispatch(stone.provider, stone.defaultModel, messages, tools);
          const latency = Date.now() - start;
          // Log success
          if (userId) {
            await admin.from("gauntlet_routing_log").insert({
              user_id: userId, run_id, node_type,
              modality: needs?.modality, complexity: needs?.complexity,
              chosen_stone: stone.provider, chosen_model: stone.defaultModel,
              reason: picked.reason, fallback_used: fallbackUsed,
              latency_ms: latency, success: true,
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

      // All failed
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

    // ── ACTION: verify ──
    if (action === "verify") {
      const results: Record<string, any> = {};
      for (const p of Object.keys(STONES)) {
        results[p] = await verifyProvider(p);
      }
      // Persist for the user if logged in
      if (userId) {
        for (const [provider, res] of Object.entries(results)) {
          await admin.from("ai_providers").upsert({
            user_id: userId,
            provider,
            status: (res as any).ok ? "active" : "error",
            last_verified_at: new Date().toISOString(),
            last_error: (res as any).error ?? null,
            capabilities: STONES[provider],
          }, { onConflict: "user_id,provider" });
        }
      }
      return json({ providers: results });
    }

    // ── ACTION: list ──
    if (action === "list") {
      if (!userId) return json({ providers: [] });
      const { data } = await admin
        .from("ai_providers")
        .select("*")
        .eq("user_id", userId)
        .order("priority", { ascending: true });
      return json({ providers: data ?? [], stones: STONES });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("[gauntlet-router] error:", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

async function getActiveProviders(admin: any, userId: string | null): Promise<string[]> {
  // If no user, only Lovable is available (always-on default)
  if (!userId) return ["lovable"];
  const { data } = await admin
    .from("ai_providers")
    .select("provider, status")
    .eq("user_id", userId)
    .eq("status", "active");
  const active = (data ?? []).map((r: any) => r.provider);
  // Lovable is always available even if not in table
  if (!active.includes("lovable") && Deno.env.get("LOVABLE_API_KEY")) {
    active.push("lovable");
  }
  return active;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
