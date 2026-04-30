// signals-narrate
// Generates the "Now Line" — one short, plain-speak sentence describing
// what's happening for the user right now. Stored in now_line_state.
//
// Sources:
//  - top live signal_moment (if any)
//  - next due life_event
//  - time of day fallback
//
// Plain-speak rules (STYLE block) match mem://design/voice-and-vocabulary.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const STYLE = `
STYLE — write like a calm, smart friend who knows the user.
- One sentence. Max 14 words.
- Plain words. No jargon. No "I'd suggest" or "based on".
- Use relative time ("in 6 days", "tomorrow", "right now").
- Address the user directly ("You", not "the user").
- No emojis. No exclamation marks unless it's a real win.
`.trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Pull a small slice of context.
    const [moments, eventsRes, profileRes] = await Promise.all([
      admin
        .from("signal_moments")
        .select("kind, headline, suggested_direction, salience, created_at")
        .eq("user_id", user.id)
        .eq("status", "live")
        .order("salience", { ascending: false })
        .limit(3),
      admin
        .from("life_events")
        .select("title, kind, next_due_at")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("next_due_at", { ascending: true, nullsFirst: false })
        .limit(3),
      admin
        .from("profiles")
        .select("full_name")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const hour = new Date().getHours();
    const partOfDay =
      hour < 5 ? "late night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : hour < 22 ? "evening" : "night";

    const ctx = {
      part_of_day: partOfDay,
      first_name: profileRes.data?.full_name?.split(" ")[0] ?? null,
      top_signals: moments.data ?? [],
      upcoming: eventsRes.data ?? [],
    };

    // Tiny, fast model. Single sentence.
    const prompt = `${STYLE}

CONTEXT (JSON):
${JSON.stringify(ctx)}

Write exactly one short sentence describing what's most useful for the user right now.
If nothing is pressing, say it's quiet in a calm way.
Return ONLY the sentence — no quotes, no prefix.`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "You write one calm, plain-spoken sentence." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("narrate gateway error", aiRes.status, t);
      return new Response(JSON.stringify({ error: "ai-error", status: aiRes.status }), {
        status: aiRes.status === 429 || aiRes.status === 402 ? aiRes.status : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    let line: string = aiJson?.choices?.[0]?.message?.content?.trim() ?? "";
    // Strip surrounding quotes if the model added any.
    line = line.replace(/^["'\s]+|["'\s]+$/g, "");
    if (!line) line = "All quiet right now.";

    const tone =
      ctx.top_signals.length > 0 && (ctx.top_signals[0].salience ?? 0) > 0.7
        ? "attentive"
        : "calm";

    await admin
      .from("now_line_state")
      .upsert(
        {
          user_id: user.id,
          text: line,
          tone,
          source: ctx.top_signals[0]?.kind ?? "schedule",
          metadata: { part_of_day: partOfDay },
        },
        { onConflict: "user_id" },
      );

    return new Response(JSON.stringify({ text: line, tone }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("signals-narrate failure", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
