// signals-brief
// The Calm Chief of Staff briefing.
//
// Pulls the day's data in parallel, computes a capacity score, asks gpt-5.4
// (via Lovable AI gateway) for a single structured payload that powers:
//   - the Now Line (one short sentence)
//   - the Top of Mind hero card
//   - eight situational/strategic cards, each with one AI interpretation line
//   - per-recommendation "Why this?" explanations
//
// Result is cached on now_line_state.metadata.brief.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGoogleAccessToken } from "../_shared/google-token.ts";

interface CalendarEvent {
  id: string;
  summary: string;
  start: string | null;
  end: string | null;
  all_day: boolean;
  location: string | null;
  hangout_link: string | null;
  attendee_count: number;
  organizer_self: boolean;
  status: string | null;
}

async function fetchCalendarEvents(userId: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
  try {
    const token = await getGoogleAccessToken(userId);
    if (!token) return [];
    const qs = new URLSearchParams({
      timeMin, timeMax,
      singleEvents: "true", orderBy: "startTime", maxResults: "40",
    });
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${qs.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const items = (data?.items ?? []) as Array<Record<string, unknown>>;
    return items.map((e) => {
      const startObj = e.start as { dateTime?: string; date?: string } | undefined;
      const endObj = e.end as { dateTime?: string; date?: string } | undefined;
      const allDay = !!startObj?.date && !startObj?.dateTime;
      const attendees = Array.isArray(e.attendees) ? (e.attendees as Array<Record<string, unknown>>) : [];
      return {
        id: String(e.id ?? crypto.randomUUID()),
        summary: (e.summary as string) ?? "(untitled)",
        start: startObj?.dateTime ?? startObj?.date ?? null,
        end: endObj?.dateTime ?? endObj?.date ?? null,
        all_day: allDay,
        location: (e.location as string) ?? null,
        hangout_link: (e.hangoutLink as string) ?? null,
        attendee_count: attendees.length,
        organizer_self: (e.organizer as { self?: boolean } | undefined)?.self === true,
        status: (e.status as string) ?? null,
      };
    });
  } catch (err) {
    console.log("[signals-brief] calendar skip:", err instanceof Error ? err.message : err);
    return [];
  }
}

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
STYLE — write like a calm, smart chief of staff who's been with the user for years.
- Plain words. No jargon. Never "task", "ticket", "blocker".
- Each sentence: max 14 words.
- Address the user as "you". Use relative time ("in 18 minutes", "tomorrow").
- No emojis. No exclamation marks. Calm.
- If something is empty, say "Clear" — never "0".
`.trim();

type CardKey = "plan" | "late" | "up_next" | "people" | "habits" | "goals" | "watch" | "won_today";

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

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);

    // Pull the day in parallel.
    const [
      lifeEventsRes,
      overdueRes,
      peopleRes,
      goalsRes,
      signalsRes,
      doneTodayRes,
      profileRes,
    ] = await Promise.all([
      admin
        .from("life_events")
        .select("id, kind, title, notes, next_due_at, recurrence_days, desired_duration_minutes, status")
        .eq("user_id", user.id)
        .eq("status", "active")
        .gte("next_due_at", todayStart.toISOString())
        .lte("next_due_at", todayEnd.toISOString())
        .order("next_due_at", { ascending: true }),
      admin
        .from("life_events")
        .select("id, kind, title, next_due_at")
        .eq("user_id", user.id)
        .eq("status", "active")
        .lt("next_due_at", todayStart.toISOString())
        .order("next_due_at", { ascending: true })
        .limit(8),
      admin
        .from("life_people")
        .select("id, name, relationship, last_contact_at")
        .eq("user_id", user.id)
        .order("last_contact_at", { ascending: true, nullsFirst: true })
        .limit(8),
      admin
        .from("life_goals")
        .select("id, title, why, target_date, progress, status, last_touched_at")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("last_touched_at", { ascending: true, nullsFirst: true })
        .limit(8),
      admin
        .from("signal_moments")
        .select("id, kind, headline, suggested_direction, salience, metadata, created_at")
        .eq("user_id", user.id)
        .eq("status", "live")
        .order("salience", { ascending: false })
        .limit(8),
      admin
        .from("life_events")
        .select("id, title, last_done_at")
        .eq("user_id", user.id)
        .gte("last_done_at", todayStart.toISOString())
        .limit(20),
      admin
        .from("profiles")
        .select("full_name")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const lifeEvents = lifeEventsRes.data ?? [];
    const overdue = overdueRes.data ?? [];
    const people = peopleRes.data ?? [];
    const goals = goalsRes.data ?? [];
    const signals = signalsRes.data ?? [];
    const doneToday = doneTodayRes.data ?? [];

    const hour = now.getHours();
    const dayMode = hour < 12 ? "morning" : hour < 17 ? "midday" : "evening";

    // Capacity heuristic: more load → heavier day.
    const loadScore =
      lifeEvents.length * 1.0 +
      overdue.length * 1.5 +
      signals.filter((s) => (s.salience ?? 0) > 0.7).length * 1.2;
    const capacityLabel: string =
      loadScore < 3 ? "Light day" :
      loadScore < 6 ? "Steady day" :
      loadScore < 10 ? "Heavy day" : "Overloaded day";

    // Habits = recurring life_events (already in lifeEvents if due today,
    // but we also peek at the broader set so habits aren't empty if none due).
    const habitsRes = await admin
      .from("life_events")
      .select("id, title, recurrence_days, last_done_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .not("recurrence_days", "is", null)
      .limit(8);
    const habits = habitsRes.data ?? [];

    const ctx = {
      day_mode: dayMode,
      capacity_label: capacityLabel,
      first_name: profileRes.data?.full_name?.split(" ")[0] ?? null,
      now_iso: now.toISOString(),
      today: lifeEvents,
      overdue,
      people: people.slice(0, 5),
      goals,
      signals: signals.slice(0, 5),
      habits: habits.slice(0, 5),
      done_today: doneToday.length,
    };

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a calm chief of staff briefing the user on their day. ${STYLE}`,
          },
          {
            role: "user",
            content: `Today mode: ${dayMode}. Capacity: ${capacityLabel}.

CONTEXT (JSON):
${JSON.stringify(ctx)}

Produce one structured briefing via the daily_brief tool. Rules:
- now_line: one short sentence introducing today.
- top_of_mind: the single highest-leverage next move. If nothing matters, set headline to "You're clear right now." with a deep-work suggestion.
- For each card, one short ai_line that interprets, doesn't list. Empty cards: ai_line = "Clear", value = "Clear".
- why_this objects must use plain English with the user's actual data points.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "daily_brief",
              description: "Single structured briefing for Today.",
              parameters: {
                type: "object",
                properties: {
                  now_line: { type: "string" },
                  capacity_label: { type: "string" },
                  top_of_mind: {
                    type: "object",
                    properties: {
                      headline: { type: "string" },
                      why_now: { type: "string" },
                      est_minutes: { type: "integer" },
                      signal_strength: { type: "string", enum: ["low", "medium", "high", "critical"] },
                      do_now_intent: { type: "string" },
                      why_this: {
                        type: "object",
                        properties: {
                          trigger: { type: "string" },
                          connection: { type: "string" },
                          matters_now: { type: "string" },
                          if_ignored: { type: "string" },
                          fastest_next: { type: "string" },
                        },
                        required: ["trigger", "matters_now", "fastest_next"],
                      },
                    },
                    required: ["headline", "why_now", "signal_strength"],
                  },
                  cards: {
                    type: "object",
                    properties: cardSchemaProperties(),
                    required: ["plan", "late", "up_next", "people", "habits", "goals", "watch", "won_today"],
                  },
                },
                required: ["now_line", "top_of_mind", "cards"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "daily_brief" } },
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("brief gateway error", aiRes.status, t);
      return new Response(JSON.stringify({ error: "ai-error", status: aiRes.status, detail: t }), {
        status: aiRes.status === 429 || aiRes.status === 402 ? aiRes.status : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const call = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    let brief: Record<string, unknown> = {};
    try {
      brief = JSON.parse(call?.function?.arguments ?? "{}");
    } catch {
      brief = {};
    }

    // Persist to now_line_state so the orb stays in sync and the brief is cached.
    const nowLineText = (brief.now_line as string) || "All quiet right now.";
    await admin
      .from("now_line_state")
      .upsert(
        {
          user_id: user.id,
          text: nowLineText,
          tone: (brief.top_of_mind as { signal_strength?: string })?.signal_strength === "critical"
            ? "attentive" : "calm",
          source: "brief",
          metadata: {
            day_mode: dayMode,
            capacity_label: brief.capacity_label || capacityLabel,
            brief,
            generated_at: now.toISOString(),
          },
        },
        { onConflict: "user_id" },
      );

    return new Response(
      JSON.stringify({
        now_line: nowLineText,
        capacity_label: brief.capacity_label || capacityLabel,
        day_mode: dayMode,
        top_of_mind: brief.top_of_mind ?? null,
        cards: brief.cards ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("signals-brief failure", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function cardSchemaProperties() {
  const cardShape = {
    type: "object",
    properties: {
      value: { type: "string", description: "Short value or 'Clear'." },
      ai_line: { type: "string", description: "One short interpretation, max 14 words." },
      action_label: { type: "string", description: "Label for the inline action button." },
      do_now_intent: { type: "string", description: "Chat prompt run when Do it now is tapped." },
      signal_strength: { type: "string", enum: ["low", "medium", "high", "critical"] },
      why_this: {
        type: "object",
        properties: {
          trigger: { type: "string" },
          connection: { type: "string" },
          matters_now: { type: "string" },
          if_ignored: { type: "string" },
          fastest_next: { type: "string" },
        },
      },
    },
    required: ["value", "ai_line", "action_label", "signal_strength"],
  } as const;

  return {
    plan: cardShape,
    late: cardShape,
    up_next: cardShape,
    people: cardShape,
    habits: cardShape,
    goals: cardShape,
    watch: cardShape,
    won_today: cardShape,
  };
}
