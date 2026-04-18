// ============================================================================
// CONNECT-BRAIN — Plug whole AI platforms into the Infinity Router.
// One API key per platform, but we expand it into multiple custom_models rows
// (one per model the platform offers) all tagged with metadata.platform_id so
// disconnect can wipe them in one shot.
// ============================================================================

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ModelDef {
  model_id: string;
  display_name: string;
  capabilities: string[];
  tier: string;
  context_window: number;
  cost_per_1k_in: number;
  cost_per_1k_out: number;
  avg_latency_ms: number;
  fallback_model_id: string | null;
}

interface PlatformPreset {
  id: string;
  label: string;
  blurb: string;
  capabilities: string[];        // platform-level summary (text/image/video/tools/voice)
  gateway_url: string;
  models: ModelDef[];            // each becomes one custom_models row
}

const PLATFORMS: Record<string, PlatformPreset> = {
  gemini: {
    id: "gemini",
    label: "Gemini",
    blurb: "Google's multimodal family — text, image, and video in one key.",
    capabilities: ["text", "image", "video", "tools"],
    gateway_url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    models: [
      { model_id: "google/gemini-2.5-pro", display_name: "Gemini 2.5 Pro", capabilities: ["tools","json","vision","long_context","reasoning"], tier: "pro", context_window: 2_000_000, cost_per_1k_in: 0.00125, cost_per_1k_out: 0.01, avg_latency_ms: 1800, fallback_model_id: "google/gemini-2.5-flash" },
      { model_id: "google/gemini-2.5-flash", display_name: "Gemini 2.5 Flash", capabilities: ["tools","json","vision","long_context"], tier: "flash", context_window: 1_000_000, cost_per_1k_in: 0.0003, cost_per_1k_out: 0.0025, avg_latency_ms: 700, fallback_model_id: "google/gemini-2.5-pro" },
      { model_id: "google/gemini-3-pro-image-preview", display_name: "Gemini 3 Pro (image)", capabilities: ["image_gen","vision"], tier: "pro", context_window: 32_000, cost_per_1k_in: 0.002, cost_per_1k_out: 0.015, avg_latency_ms: 8000, fallback_model_id: null },
      { model_id: "google/veo-3-fast", display_name: "Veo 3 Fast", capabilities: ["video_gen"], tier: "flash", context_window: 32_000, cost_per_1k_in: 0.001, cost_per_1k_out: 0.01, avg_latency_ms: 30000, fallback_model_id: null },
    ],
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    blurb: "GPT-5 family — strong tool use and reasoning.",
    capabilities: ["text", "tools", "voice"],
    gateway_url: "https://api.openai.com/v1/chat/completions",
    models: [
      { model_id: "openai/gpt-5", display_name: "GPT-5", capabilities: ["tools","json","vision","reasoning"], tier: "standard", context_window: 400_000, cost_per_1k_in: 0.005, cost_per_1k_out: 0.02, avg_latency_ms: 1500, fallback_model_id: "openai/gpt-5-mini" },
      { model_id: "openai/gpt-5-mini", display_name: "GPT-5 Mini", capabilities: ["tools","json","reasoning"], tier: "flash", context_window: 256_000, cost_per_1k_in: 0.0008, cost_per_1k_out: 0.0032, avg_latency_ms: 900, fallback_model_id: "openai/gpt-5-nano" },
      { model_id: "openai/gpt-5-nano", display_name: "GPT-5 Nano", capabilities: ["tools","json"], tier: "nano", context_window: 256_000, cost_per_1k_in: 0.0002, cost_per_1k_out: 0.0008, avg_latency_ms: 500, fallback_model_id: null },
    ],
  },
  anthropic: {
    id: "anthropic",
    label: "Claude",
    blurb: "Anthropic's deep-reasoning, long-context model.",
    capabilities: ["text", "tools"],
    gateway_url: "https://api.anthropic.com/v1/messages",
    models: [
      { model_id: "anthropic/claude-opus-4", display_name: "Claude Opus 4", capabilities: ["tools","json","vision","reasoning","long_context"], tier: "pro", context_window: 200_000, cost_per_1k_in: 0.015, cost_per_1k_out: 0.075, avg_latency_ms: 1800, fallback_model_id: "anthropic/claude-sonnet-4" },
      { model_id: "anthropic/claude-sonnet-4", display_name: "Claude Sonnet 4", capabilities: ["tools","json","vision","reasoning","long_context"], tier: "standard", context_window: 200_000, cost_per_1k_in: 0.003, cost_per_1k_out: 0.015, avg_latency_ms: 1300, fallback_model_id: null },
    ],
  },
  xai: {
    id: "xai",
    label: "Grok",
    blurb: "xAI's witty, real-time reasoning model.",
    capabilities: ["text", "tools"],
    gateway_url: "https://api.x.ai/v1/chat/completions",
    models: [
      { model_id: "xai/grok-4", display_name: "Grok 4", capabilities: ["tools","json","reasoning"], tier: "standard", context_window: 256_000, cost_per_1k_in: 0.005, cost_per_1k_out: 0.015, avg_latency_ms: 1500, fallback_model_id: null },
    ],
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    blurb: "European open-weights frontier model.",
    capabilities: ["text", "tools"],
    gateway_url: "https://api.mistral.ai/v1/chat/completions",
    models: [
      { model_id: "mistral/mistral-large-latest", display_name: "Mistral Large", capabilities: ["tools","json","reasoning"], tier: "standard", context_window: 128_000, cost_per_1k_in: 0.002, cost_per_1k_out: 0.006, avg_latency_ms: 1200, fallback_model_id: null },
    ],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    blurb: "Cost-efficient reasoning model.",
    capabilities: ["text", "tools"],
    gateway_url: "https://api.deepseek.com/v1/chat/completions",
    models: [
      { model_id: "deepseek/deepseek-chat", display_name: "DeepSeek Chat", capabilities: ["tools","json","reasoning"], tier: "flash", context_window: 128_000, cost_per_1k_in: 0.00014, cost_per_1k_out: 0.00028, avg_latency_ms: 1000, fallback_model_id: null },
    ],
  },
};

interface ReqBody {
  action: "connect" | "disconnect" | "list_presets" | "list_status";
  platform_id?: string;
  // legacy alias
  preset_id?: string;
  api_key?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Invalid token" }, 401);
    const userId = userData.user.id;

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const platformId = body.platform_id || body.preset_id;
    const admin = createClient(supabaseUrl, serviceKey);

    // ---------------- list_presets ----------------
    if (body.action === "list_presets") {
      return json({
        platforms: Object.values(PLATFORMS).map((p) => ({
          id: p.id, label: p.label, blurb: p.blurb, capabilities: p.capabilities,
        })),
      });
    }

    // ---------------- list_status ----------------
    if (body.action === "list_status" || !body.action) {
      const { data: rows } = await admin
        .from("custom_models")
        .select("model_id, api_key_secret_name, metadata")
        .eq("user_id", userId);
      const byPlatform = new Map<string, { last4: string }>();
      for (const r of (rows || []) as Array<{ model_id: string; api_key_secret_name: string | null; metadata: Record<string, unknown> | null }>) {
        const pid = (r.metadata?.platform_id as string) || inferPlatformIdFromModelId(r.model_id);
        if (!pid) continue;
        const secret = r.api_key_secret_name || "";
        const last4 = secret.startsWith("inline:") ? secret.slice(-4) : "••••";
        byPlatform.set(pid, { last4 });
      }
      // Higgsfield is special — stored in integration_connections
      const { data: hf } = await admin
        .from("integration_connections")
        .select("id")
        .eq("user_id", userId)
        .eq("provider", "higgsfield")
        .eq("status", "connected")
        .maybeSingle();

      const status = Object.values(PLATFORMS).map((p) => {
        const c = byPlatform.get(p.id);
        return {
          id: p.id,
          label: p.label,
          blurb: p.blurb,
          capabilities: p.capabilities,
          connected: !!c,
          last4: c?.last4 || null,
        };
      });
      // Append higgsfield virtual entry
      status.push({
        id: "higgsfield",
        label: "Higgsfield AI",
        blurb: "Cinematic AI video & image generation.",
        capabilities: ["video", "image"],
        connected: !!hf,
        last4: hf ? "••••" : null,
      });
      return json({ platforms: status });
    }

    // ---------------- connect ----------------
    if (body.action === "connect") {
      if (!platformId || !PLATFORMS[platformId]) {
        return json({ error: "Unknown platform" }, 400);
      }
      if (!body.api_key || body.api_key.length < 8) {
        return json({ error: "API key required (min 8 chars)" }, 400);
      }

      const platform = PLATFORMS[platformId];
      const inlineSecret = `inline:${body.api_key}`;

      // Wipe any existing rows for this platform first (so we don't leave stale models behind)
      await admin
        .from("custom_models")
        .delete()
        .eq("user_id", userId)
        .eq("metadata->>platform_id", platform.id);

      const rows = platform.models.map((m) => ({
        user_id: userId,
        model_id: m.model_id,
        display_name: m.display_name,
        gateway_url: platform.gateway_url,
        api_key_secret_name: inlineSecret,
        context_window: m.context_window,
        cost_per_1k_in: m.cost_per_1k_in,
        cost_per_1k_out: m.cost_per_1k_out,
        avg_latency_ms: m.avg_latency_ms,
        capabilities: m.capabilities,
        tier: m.tier,
        fallback_model_id: m.fallback_model_id,
        enabled: true,
        metadata: { platform_id: platform.id },
      }));

      const { error: upErr } = await admin
        .from("custom_models")
        .upsert(rows, { onConflict: "user_id,model_id" });

      if (upErr) return json({ error: upErr.message }, 500);

      return json({
        success: true,
        platform_id: platform.id,
        label: platform.label,
        capabilities: platform.capabilities,
        last4: body.api_key.slice(-4),
      });
    }

    // ---------------- disconnect ----------------
    if (body.action === "disconnect") {
      if (!platformId) return json({ error: "platform_id required" }, 400);
      if (!PLATFORMS[platformId]) return json({ error: "Unknown platform" }, 400);

      const { error: delErr } = await admin
        .from("custom_models")
        .delete()
        .eq("user_id", userId)
        .eq("metadata->>platform_id", platformId);

      if (delErr) return json({ error: delErr.message }, 500);
      return json({ success: true, platform_id: platformId });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function inferPlatformIdFromModelId(modelId: string): string | null {
  const prefix = modelId.split("/")[0];
  if (prefix === "google") return "gemini";
  if (prefix === "openai") return "openai";
  if (prefix === "anthropic") return "anthropic";
  if (prefix === "xai") return "xai";
  if (prefix === "mistral") return "mistral";
  if (prefix === "deepseek") return "deepseek";
  return null;
}
