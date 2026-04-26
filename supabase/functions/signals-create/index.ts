// signals-create — user-captured signals, classified by The Brain (gauntlet-router).
//
// IMPORTANT: This function makes ZERO direct calls to ai.gateway.lovable.dev.
// Every model call goes through `_shared/gauntlet-call.ts` → gauntlet-router,
// so the system picks the cheapest capable stone (OpenAI / Gemini / Anthropic /
// xAI / DeepSeek / Mistral / Lovable) per request and the choice is logged so
// the Brain can learn from outcomes (see signals-tune brain_routing_pref).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { gauntletCall } from "../_shared/gauntlet-call.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function resolveUser(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

async function embed(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY || !text) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 4000) }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.[0]?.embedding ?? null;
  } catch { return null; }
}

const CLASSIFY_TOOL = {
  type: "function",
  function: {
    name: "classify_signal",
    description: "Classify a user-captured note into a structured signal moment.",
    parameters: {
      type: "object",
      properties: {
        signal_type: { type: "string", enum: ["message", "task", "reminder", "thought"] },
        headline: { type: "string", description: "≤14 words, present tense, no fluff." },
        reason: { type: "string", description: "1 sentence why this matters now." },
        suggested_direction: { type: "string", description: "Concrete next action; empty if none." },
        salience: { type: "number", minimum: 0, maximum: 1 },
        priority: { type: "string", enum: ["low", "med", "high"] },
        target_integration: {
          type: "string",
          enum: ["gmail", "slack", "clickup", "calendar", "none"],
          description: "Where the action would land if executed.",
        },
      },
      required: ["signal_type", "headline", "salience", "priority", "target_integration"],
      additionalProperties: false,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const userId = await resolveUser(authHeader);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const text = (body.text as string | undefined)?.trim();
    if (!text || text.length < 2) {
      return new Response(JSON.stringify({ error: "text required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Brain call: classify via gauntlet-router (NEVER direct gateway) ───
    const sysPrompt = `You triage a user's pressing capture into a structured signal.
Be terse. Default to signal_type="task" if it requires the user to do something,
"message" if a person needs a reply, "reminder" for time-bound nudges,
"thought" only when nothing is actionable. Salience reflects urgency NOW (0-1).`;

    const result = await gauntletCall({
      agent: "signals-create" as any,
      authHeader,
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: text },
      ],
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: "function", function: { name: "classify_signal" } },
      modality: "text",
      complexity: "low",
      latency_priority: "fast",
    });

    let parsed: any = null;
    if (result.ok) {
      const choice = (result.data as any)?.choices?.[0];
      const toolCall = choice?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        try { parsed = JSON.parse(toolCall.function.arguments); } catch { /* ignore */ }
      }
    }

    // Fallback if model didn't tool-call: degrade gracefully, still record the capture.
    if (!parsed) {
      parsed = {
        signal_type: "thought",
        headline: text.slice(0, 100),
        reason: null,
        suggested_direction: null,
        salience: 0.55,
        priority: "med",
        target_integration: "none",
      };
    }

    // ─── Dedupe via embedding ───
    const emb = await embed(`${parsed.headline}\n${text}`);
    if (emb) {
      const { data: dupes } = await admin.rpc("match_signal_moments", {
        query_embedding: JSON.stringify(emb),
        match_threshold: 0.82,
        match_count: 1,
        filter_user_id: userId,
        hours_back: 48,
      });
      if (dupes && (dupes as any[]).length > 0) {
        return new Response(JSON.stringify({
          ok: true,
          deduped: true,
          existing_id: (dupes as any[])[0].id,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ─── Insert ───
    const insert: Record<string, unknown> = {
      user_id: userId,
      kind: "user_created",
      headline: String(parsed.headline ?? text.slice(0, 100)).slice(0, 200),
      reason: parsed.reason ? String(parsed.reason).slice(0, 600) : null,
      suggested_direction: parsed.suggested_direction ? String(parsed.suggested_direction).slice(0, 400) : null,
      salience: Math.max(0, Math.min(1, Number(parsed.salience) || 0.6)),
      confidence: 0.85,
      mode_context: "any",
      status: "live",
      source_refs: [{ type: "user_capture", text: text.slice(0, 400) }],
      metadata: {
        signal_type: parsed.signal_type,
        priority: parsed.priority,
        target_integration: parsed.target_integration,
        user_created: true,
        captured_text: text.slice(0, 1000),
        brain_stone: result.modelUsed ?? null,
        brain_latency_ms: result.latencyMs ?? null,
        routing_reason: (result as any).reason ?? null,
        fallback_used: result.fallbackUsed ?? false,
      },
    };
    if (emb) insert.embedding = JSON.stringify(emb);

    const { data: inserted, error } = await admin
      .from("signal_moments").insert(insert).select("id").maybeSingle();
    if (error) throw error;

    return new Response(JSON.stringify({
      ok: true,
      id: inserted?.id,
      classification: parsed,
      brain: { stone: result.modelUsed, latency_ms: result.latencyMs },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("[signals-create] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
