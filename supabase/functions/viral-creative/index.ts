import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

async function callAI(systemPrompt: string, userPrompt: string, apiKey: string) {
  const res = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
    }),
  });

  if (!res.ok) {
    const status = res.status;
    if (status === 429) throw new Error("Rate limited — please try again shortly.");
    if (status === 402) throw new Error("AI credits exhausted — add funds in Settings > Workspace > Usage.");
    throw new Error(`AI gateway error: ${status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function parseJSON(text: string): unknown {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned);
}

async function callAIJSON(systemPrompt: string, userPrompt: string, apiKey: string) {
  const raw = await callAI(systemPrompt + "\n\nRespond ONLY with valid JSON, no markdown.", userPrompt, apiKey);
  return parseJSON(raw);
}

// ── System Prompts ──────────────────────────────────────────────

const ANGLE_SYSTEM = `You are a viral marketing strategist. Given a campaign goal and context, generate 6-10 strong marketing angles. For each angle return: { "name": string, "type": string (e.g. "problem_solution", "transformation", "urgency", "authority", "curiosity", "emotional_pain", "aspiration", "status", "ugc_native", "direct_response", "premium_luxury", "local_trust"), "description": string, "why_it_works": string, "example_headline": string }. Return a JSON array.`;

const HOOK_SYSTEM = `You are a viral content hook specialist. Given angles and context, generate 8-12 viral hook concepts. For each: { "hook_text": string, "hook_type": string (e.g. "stop_scroll", "curiosity", "emotional", "polarizing", "what_is_this", "authority", "shocking_contrast"), "visual_concept": string, "why_it_stops_scroll": string }. Return a JSON array.`;

const PROMPT_SYSTEM = `You are a visual prompt engineer specializing in AI video/image generation (Higgsfield). Given angles, hooks, platform, and content goal, generate 4-6 optimized visual prompts. Each prompt should include: { "prompt_text": string (detailed scene description optimized for Higgsfield), "angle_name": string, "hook_reference": string, "scene_composition": string, "visual_emotion": string, "style": string (cinematic/commercial/ugc/editorial), "platform_optimization": string, "cta_safe_zone": boolean, "headline_safe_zone": boolean }. Return a JSON array.`;

const SCORE_SYSTEM = `You are a creative performance analyst. Score each prompt candidate on these dimensions (0-100): hook_strength, novelty, emotional_charge, visual_clarity, conversion_potential, platform_fit, repurpose_potential, audience_resonance. Return { "scores": [ { "prompt_index": number, "dimensions": { hook_strength: number, ... }, "total_score": number, "recommendation": string } ] }.`;

const CLUSTER_SYSTEM = `You are a content strategist. Given mixed source material (notes, ideas, references), cluster them by themes. Return { "clusters": [ { "theme": string, "items": string[], "creative_opportunity": string, "strength": number (1-10) } ] }.`;

const REFERENCE_SYSTEM = `You are a competitive creative analyst. Analyze provided reference content/competitor examples for patterns. Do NOT copy — identify patterns to inspire original work. Return { "patterns": [ { "pattern_name": string, "description": string, "visual_elements": string[], "emotional_tone": string, "likely_reason_it_works": string, "original_variation_idea": string } ] }.`;

const REPURPOSE_SYSTEM = `You are a content repurposing expert. Given one creative concept, transform it into multiple format variants. Return { "variants": [ { "format": string (e.g. "static_image_ad", "short_promo_video", "story_reel", "thumbnail", "product_hero", "lead_magnet_visual", "before_after", "testimonial_visual"), "prompt_text": string, "platform": string, "dimensions_note": string, "key_adaptation": string } ] }.`;

const PACKAGE_SYSTEM = `You are a creative director packaging final outputs. For each selected prompt, generate a complete output package: { "packages": [ { "title": string, "angle_name": string, "hook_line": string, "caption_suggestion": string, "cta_suggestion": string, "recommended_platform": string, "recommended_use_case": string, "prompt_text": string } ] }.`;

// ── Handler ─────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "AI gateway not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, ...params } = body;

    let result: unknown;

    switch (action) {
      case "test_connection": {
        // Quick check that the AI gateway responds
        const test = await callAI("Reply with 'ok'", "ping", LOVABLE_API_KEY);
        result = { connected: true, response: test.slice(0, 50) };
        break;
      }

      case "analyze_angles": {
        const { request_text, source_context, platform, content_goal } = params;
        const userPrompt = `Campaign goal: ${request_text}\nPlatform: ${platform || "general"}\nContent goal: ${content_goal || "conversion"}\nAdditional context: ${JSON.stringify(source_context || {})}`;
        result = await callAIJSON(ANGLE_SYSTEM, userPrompt, LOVABLE_API_KEY);
        break;
      }

      case "extract_hooks": {
        const { angles, request_text, platform } = params;
        const userPrompt = `Angles: ${JSON.stringify(angles)}\nCampaign: ${request_text}\nPlatform: ${platform || "general"}`;
        result = await callAIJSON(HOOK_SYSTEM, userPrompt, LOVABLE_API_KEY);
        break;
      }

      case "generate_prompts": {
        const { angles, hooks, platform, content_goal, request_text } = params;
        const userPrompt = `Angles: ${JSON.stringify(angles)}\nHooks: ${JSON.stringify(hooks)}\nPlatform: ${platform || "general"}\nGoal: ${content_goal || "conversion"}\nCampaign: ${request_text}`;
        result = await callAIJSON(PROMPT_SYSTEM, userPrompt, LOVABLE_API_KEY);
        break;
      }

      case "score_concepts": {
        const { prompt_candidates, platform, content_goal } = params;
        const userPrompt = `Prompts: ${JSON.stringify(prompt_candidates)}\nPlatform: ${platform || "general"}\nGoal: ${content_goal || "conversion"}`;
        result = await callAIJSON(SCORE_SYSTEM, userPrompt, LOVABLE_API_KEY);
        break;
      }

      case "cluster_content": {
        const { source_material } = params;
        const userPrompt = `Source material:\n${source_material}`;
        result = await callAIJSON(CLUSTER_SYSTEM, userPrompt, LOVABLE_API_KEY);
        break;
      }

      case "analyze_reference": {
        const { reference_text } = params;
        const userPrompt = `Reference/competitor content:\n${reference_text}`;
        result = await callAIJSON(REFERENCE_SYSTEM, userPrompt, LOVABLE_API_KEY);
        break;
      }

      case "repurpose": {
        const { concept, platform } = params;
        const userPrompt = `Original concept: ${JSON.stringify(concept)}\nPrimary platform: ${platform || "general"}`;
        result = await callAIJSON(REPURPOSE_SYSTEM, userPrompt, LOVABLE_API_KEY);
        break;
      }

      case "generate_output_package": {
        const { selected_prompts, angles } = params;
        const userPrompt = `Selected prompts: ${JSON.stringify(selected_prompts)}\nAngles used: ${JSON.stringify(angles)}`;
        result = await callAIJSON(PACKAGE_SYSTEM, userPrompt, LOVABLE_API_KEY);
        break;
      }

      case "full_pipeline": {
        const { request_text, source_context, platform, content_goal, reference_text } = params;

        // 1. Angles
        const anglesPrompt = `Campaign goal: ${request_text}\nPlatform: ${platform || "general"}\nContent goal: ${content_goal || "conversion"}\nContext: ${JSON.stringify(source_context || {})}`;
        const angles = await callAIJSON(ANGLE_SYSTEM, anglesPrompt, LOVABLE_API_KEY);

        // 2. Hooks
        const hooksPrompt = `Angles: ${JSON.stringify(angles)}\nCampaign: ${request_text}\nPlatform: ${platform || "general"}`;
        const hooks = await callAIJSON(HOOK_SYSTEM, hooksPrompt, LOVABLE_API_KEY);

        // 3. Reference analysis (if provided)
        let referenceAnalysis = null;
        if (reference_text) {
          referenceAnalysis = await callAIJSON(REFERENCE_SYSTEM, `Reference:\n${reference_text}`, LOVABLE_API_KEY);
        }

        // 4. Prompts
        const promptsInput = `Angles: ${JSON.stringify(angles)}\nHooks: ${JSON.stringify(hooks)}\nPlatform: ${platform || "general"}\nGoal: ${content_goal || "conversion"}\nCampaign: ${request_text}${referenceAnalysis ? `\nReference patterns: ${JSON.stringify(referenceAnalysis)}` : ""}`;
        const prompts = await callAIJSON(PROMPT_SYSTEM, promptsInput, LOVABLE_API_KEY);

        // 5. Score
        const scoreInput = `Prompts: ${JSON.stringify(prompts)}\nPlatform: ${platform || "general"}\nGoal: ${content_goal || "conversion"}`;
        const scores = await callAIJSON(SCORE_SYSTEM, scoreInput, LOVABLE_API_KEY);

        // 6. Package
        const packageInput = `Selected prompts: ${JSON.stringify(prompts)}\nAngles: ${JSON.stringify(angles)}`;
        const packages = await callAIJSON(PACKAGE_SYSTEM, packageInput, LOVABLE_API_KEY);

        result = {
          angles,
          hooks,
          reference_analysis: referenceAnalysis,
          prompt_candidates: prompts,
          score_data: scores,
          output_packages: packages,
        };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("viral-creative error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
