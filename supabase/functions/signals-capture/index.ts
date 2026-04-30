// signals-capture
// Single endpoint that accepts free text from the "+" capture sheet and routes
// it to the right table:
//
//   - life_people     (a person to remember)
//   - life_events     (a reminder, birthday, recurring care item, follow-up)
//   - signal_moments  (a thought / general capture — falls through to existing)
//
// A small fast model classifies + extracts. Plain-speak only.

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

interface CaptureBody { text: string }

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

    const body = (await req.json()) as CaptureBody;
    const text = (body?.text ?? "").trim();
    if (!text || text.length > 1000) {
      return new Response(JSON.stringify({ error: "invalid text" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Classify + extract via tool calling.
    const today = new Date().toISOString().slice(0, 10);
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content: `You route short captures into one of: person, event, reminder, goal, thought.
- "person": about someone in the user's life (name, relationship, birthday, notes).
- "event": a recurring or one-off life admin item (haircut, dentist, oil change, renewal, follow-up, birthday celebration).
- "reminder": a one-off reminder with a clear when ("call mom tomorrow", "pay rent friday").
- "goal": a bigger life or work goal ("ship Q4 launch by Dec 1", "lose 10 lbs", "hire VP of Sales"). Often starts with "goal:" or names a target.
- "thought": anything else — pass through.
Today is ${today}. Use that to resolve "tomorrow", "next week", etc.
Return strict JSON via the route_capture tool.`,
          },
          { role: "user", content: text },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "route_capture",
              description: "Classify and extract structured fields from a capture.",
              parameters: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: ["person", "event", "reminder", "goal", "thought"] },
                  title: { type: "string", description: "Short label for the item." },
                  person_name: { type: "string" },
                  relationship: { type: "string" },
                  birthday: { type: "string", description: "ISO YYYY-MM-DD if mentioned." },
                  next_due_at: { type: "string", description: "ISO datetime if mentioned." },
                  recurrence_days: { type: "integer" },
                  desired_duration_minutes: { type: "integer" },
                  notes: { type: "string" },
                  event_kind: {
                    type: "string",
                    enum: ["birthday", "care", "reminder", "follow_up", "renewal", "open_intent"],
                  },
                },
                required: ["kind", "title"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "route_capture" } },
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("capture gateway error", aiRes.status, t);
      return new Response(JSON.stringify({ error: "ai-error", status: aiRes.status }), {
        status: aiRes.status === 429 || aiRes.status === 402 ? aiRes.status : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const call = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(call?.function?.arguments ?? "{}");
    } catch {
      parsed = {};
    }
    const kind = (parsed.kind as string) || "thought";
    const title = (parsed.title as string) || text.slice(0, 80);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    if (kind === "person") {
      const { data, error } = await admin
        .from("life_people")
        .insert({
          user_id: user.id,
          name: (parsed.person_name as string) || title,
          relationship: (parsed.relationship as string) ?? null,
          birthday: (parsed.birthday as string) ?? null,
          notes: (parsed.notes as string) ?? text,
        })
        .select("id")
        .single();
      if (error) throw error;
      // If a birthday was supplied, also create a recurring birthday event.
      if (parsed.birthday) {
        await admin.from("life_events").insert({
          user_id: user.id,
          person_id: data.id,
          kind: "birthday",
          title: `${(parsed.person_name as string) || title}'s birthday`,
          next_due_at: nextBirthday(parsed.birthday as string),
          recurrence_days: 365,
        });
      }
      return jsonOk({ kind: "person", id: data.id });
    }

    if (kind === "event" || kind === "reminder") {
      const { data, error } = await admin
        .from("life_events")
        .insert({
          user_id: user.id,
          kind: (parsed.event_kind as string) || (kind === "reminder" ? "reminder" : "open_intent"),
          title,
          notes: (parsed.notes as string) ?? text,
          next_due_at: (parsed.next_due_at as string) ?? null,
          recurrence_days: (parsed.recurrence_days as number) ?? null,
          desired_duration_minutes: (parsed.desired_duration_minutes as number) ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return jsonOk({ kind: kind === "reminder" ? "reminder" : "event", id: data.id });
    }

    if (kind === "goal") {
      const { data, error } = await admin
        .from("life_goals")
        .insert({
          user_id: user.id,
          title,
          why: (parsed.notes as string) ?? null,
          target_date: (parsed.next_due_at as string)?.slice(0, 10) ?? null,
          status: "active",
        })
        .select("id")
        .single();
      if (error) throw error;
      return jsonOk({ kind: "goal", id: data.id });
    }

    // Fallback: thought → goes into signal_moments as a user_created capture so
    // the existing Brain triage layer picks it up.
    const { data: sig, error: sigErr } = await admin
      .from("signal_moments")
      .insert({
        user_id: user.id,
        kind: "user_created",
        headline: title,
        reason: text,
        salience: 0.4,
        confidence: 0.6,
        mode_context: "any",
        status: "live",
        metadata: { signal_type: "thought", source: "today_capture" },
      })
      .select("id")
      .single();
    if (sigErr) throw sigErr;
    return jsonOk({ kind: "thought", id: sig.id });
  } catch (e) {
    console.error("signals-capture failure", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function jsonOk(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Given a YYYY-MM-DD birthday, return ISO datetime of the next occurrence.
function nextBirthday(iso: string): string {
  const [, mm, dd] = iso.split("-").map(Number);
  if (!mm || !dd) return new Date().toISOString();
  const now = new Date();
  let year = now.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, mm - 1, dd, 12, 0, 0));
  if (candidate.getTime() < now.getTime()) {
    year += 1;
  }
  return new Date(Date.UTC(year, mm - 1, dd, 12, 0, 0)).toISOString();
}
