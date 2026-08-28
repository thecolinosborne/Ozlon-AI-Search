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

// Google token is refreshed once per invocation and shared by the calendar and
// Gmail scans — refreshing twice in parallel can invalidate the newer token.
const tokenCache = new Map<string, { token: string | null; at: number }>();
async function getSharedGoogleToken(userId: string): Promise<string | null> {
  const hit = tokenCache.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.token;
  let token: string | null = null;
  try {
    token = (await getGoogleAccessToken(userId)) ?? null;
  } catch (err) {
    console.log("[signals-brief] google token error:", err instanceof Error ? err.message : err);
  }
  tokenCache.set(userId, { token, at: Date.now() });
  return token;
}

async function fetchCalendarEvents(userId: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
  try {
    const token = await getSharedGoogleToken(userId);
    if (!token) return [];
    const qs = new URLSearchParams({
      timeMin, timeMax,
      singleEvents: "true", orderBy: "startTime", maxResults: "40",
    });
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${qs.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      console.log("[signals-brief] calendar list failed:", res.status, (await res.text()).slice(0, 200));
      return [];
    }
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

interface EmailThread {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string | null;
  unread: boolean;
}

// Light Gmail scan: recent inbox messages (metadata only) so the brief can spot
// people waiting on you and deadlines buried in email.
async function fetchRecentEmail(userId: string): Promise<EmailThread[]> {
  try {
    const token = await getSharedGoogleToken(userId);
    if (!token) {
      console.log("[signals-brief] gmail: no google token");
      return [];
    }
    const q = encodeURIComponent("newer_than:3d -in:chats -category:promotions -category:social");
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=${q}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!listRes.ok) {
      console.log("[signals-brief] gmail list failed:", listRes.status, (await listRes.text()).slice(0, 200));
      return [];
    }
    const listJson = await listRes.json();
    const ids = ((listJson?.messages ?? []) as Array<{ id: string }>).map((m) => m.id).slice(0, 15);
    const details = await Promise.all(
      ids.map(async (id) => {
        try {
          const r = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!r.ok) return null;
          const m = await r.json();
          const headers = (m?.payload?.headers ?? []) as Array<{ name: string; value: string }>;
          const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n)?.value ?? "";
          return {
            id: String(m.id),
            from: h("from"),
            subject: h("subject") || "(no subject)",
            snippet: String(m.snippet ?? "").slice(0, 220),
            date: h("date") || null,
            unread: Array.isArray(m.labelIds) && m.labelIds.includes("UNREAD"),
          } as EmailThread;
        } catch {
          return null;
        }
      }),
    );
    const out = details.filter((d): d is EmailThread => !!d);
    console.log("[signals-brief] gmail scanned:", out.length);
    return out;
  } catch (err) {
    console.log("[signals-brief] gmail skip:", err instanceof Error ? err.message : err);
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
    const reqUrl = new URL(req.url);
    const mode = reqUrl.searchParams.get("mode");
    const auth = req.headers.get("Authorization") ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const isServiceCaller = !!SERVICE_ROLE && bearer === SERVICE_ROLE;

    // Morning fan-out: cron calls ?mode=tick with the service role.
    // Bounded to 50 recently-active users, one brief each, best-effort.
    if (mode === "tick") {
      if (!isServiceCaller) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const adminTick = createClient(SUPABASE_URL, SERVICE_ROLE);
      const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
      const { data: actives } = await adminTick
        .from("now_line_state")
        .select("user_id")
        .gte("updated_at", since)
        .limit(50);
      let ok = 0;
      for (const row of actives ?? []) {
        try {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/signals-brief`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_ROLE}`,
              apikey: SUPABASE_ANON_KEY,
              "x-user-id": row.user_id as string,
            },
            body: "{}",
          });
          if (r.ok) ok++;
        } catch (e) {
          console.log("[signals-brief tick] skip", e instanceof Error ? e.message : e);
        }
      }
      return new Response(JSON.stringify({ mode: "tick", attempted: (actives ?? []).length, ok }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let user: { id: string } | null = null;
    if (isServiceCaller && req.headers.get("x-user-id")) {
      user = { id: req.headers.get("x-user-id") as string };
    } else {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: auth } },
      });
      const { data: userData } = await userClient.auth.getUser();
      user = userData?.user ?? null;
    }
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
      calendarEvents,
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
      // Pull Google Calendar from now → end of tomorrow so Today's Plan + Up Next have real meetings
      fetchCalendarEvents(
        user.id,
        now.toISOString(),
        new Date(todayEnd.getTime() + 24 * 3600_000).toISOString(),
      ),
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
    const [habitsRes, emailThreads, eventDeadlinesRes] = await Promise.all([
      admin
        .from("life_events")
        .select("id, title, recurrence_days, last_done_at")
        .eq("user_id", user.id)
        .eq("status", "active")
        .not("recurrence_days", "is", null)
        .limit(8),
      fetchRecentEmail(user.id),
      // Saved events with an RSVP/registration deadline in the next 14 days,
      // excluding ones already marked going or skip.
      admin
        .from("discovered_events")
        .select("id, title, event_date, rsvp_deadline, cost_text, is_free, registration_url, rsvp_status")
        .eq("user_id", user.id)
        .not("rsvp_deadline", "is", null)
        .gte("rsvp_deadline", now.toISOString())
        .lte("rsvp_deadline", new Date(now.getTime() + 14 * 24 * 3600_000).toISOString())
        .not("rsvp_status", "in", '("going","skip")')
        .order("rsvp_deadline", { ascending: true })
        .limit(10),
    ]);
    const habits = habitsRes.data ?? [];
    const eventDeadlines = eventDeadlinesRes.data ?? [];

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
      calendar_today: calendarEvents
        .filter((e) => e.start && new Date(e.start) <= todayEnd)
        .slice(0, 12)
        .map((e) => ({ start: e.start, end: e.end, title: e.summary, attendees: e.attendee_count, location: e.location })),
      calendar_tomorrow_count: calendarEvents.filter((e) => e.start && new Date(e.start) > todayEnd).length,
      recent_email: emailThreads.slice(0, 15).map((e) => ({
        from: e.from, subject: e.subject, snippet: e.snippet, date: e.date, unread: e.unread,
      })),
      event_deadlines: eventDeadlines.map((e) => ({
        title: e.title,
        event_date: e.event_date,
        rsvp_deadline: e.rsvp_deadline,
        cost: e.is_free ? "free" : e.cost_text,
        undecided: e.rsvp_status !== "going",
      })),
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
- why_this objects must use plain English with the user's actual data points.
- todos: up to 7 concrete things to do today, ranked most important first. Draw from overdue items, today's life events, meeting prep implied by the calendar, and replies clearly owed from recent_email. Each title is an action starting with a verb, max 10 words. Set source to where it came from. Skip newsletters, receipts, and marketing mail.
- watchouts: up to 5 things to keep an eye on: back-to-back or conflicting meetings, a meeting with no prep, a promise made in email with a date, someone waiting more than two days, a goal going stale, an undecided event in event_deadlines whose RSVP deadline is close. Never invent facts; each one must trace to context. If there is nothing real, return an empty list.
- do_now_intent on every item: a short chat prompt that starts the work.`,

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
                  todos: {
                    type: "array",
                    description: "Ranked things to do today.",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        detail: { type: "string", description: "One short line of context." },
                        source: { type: "string", enum: ["email", "calendar", "life", "goal", "signal", "person"] },
                        urgency: { type: "string", enum: ["low", "medium", "high", "critical"] },
                        est_minutes: { type: "integer" },
                        do_now_intent: { type: "string" },
                      },
                      required: ["title", "source", "urgency"],
                    },
                  },
                  watchouts: {
                    type: "array",
                    description: "Things to keep an eye on today.",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        detail: { type: "string" },
                        source: { type: "string", enum: ["email", "calendar", "life", "goal", "signal", "person"] },
                        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                        do_now_intent: { type: "string" },
                      },
                      required: ["title", "source", "severity"],
                    },
                  },
                },
                required: ["now_line", "top_of_mind", "cards", "todos", "watchouts"],

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
        todos: brief.todos ?? [],
        watchouts: brief.watchouts ?? [],
        email_scanned: emailThreads.length,
        calendar_events: calendarEvents,
        calendar_connected: calendarEvents.length > 0 || !!(await getSharedGoogleToken(user.id)),
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
