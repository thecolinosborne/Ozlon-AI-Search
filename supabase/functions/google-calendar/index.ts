import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  corsHeaders,
  getAuthedUserId,
  getGoogleAccessToken,
  jsonErr,
  jsonOk,
} from "../_shared/google-token.ts";

const CAL_BASE = "https://www.googleapis.com/calendar/v3";

type AnyJson = Record<string, unknown>;

async function gFetch(token: string, url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Calendar API ${res.status}: ${JSON.stringify(data)}`);
  return data as AnyJson;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userId = await getAuthedUserId(req);
    const { action, params = {} } = (await req.json()) as { action: string; params?: AnyJson };
    if (!action) return jsonErr("Missing action");

    const token = await getGoogleAccessToken(userId);

    switch (action) {
      case "list_calendars": {
        const data = await gFetch(token, `${CAL_BASE}/users/me/calendarList`);
        return jsonOk({ success: true, ...data });
      }

      case "get_calendar": {
        const calendarId = String((params as AnyJson).calendarId || "primary");
        const data = await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}`);
        return jsonOk({ success: true, calendar: data });
      }

      case "list_events": {
        const calendarId = String((params as AnyJson).calendarId || "primary");
        const qs = new URLSearchParams();
        const timeMin = String((params as AnyJson).timeMin || "");
        const timeMax = String((params as AnyJson).timeMax || "");
        const q = String((params as AnyJson).q || "");
        const maxResults = Number((params as AnyJson).maxResults || 50);
        const pageToken = String((params as AnyJson).pageToken || "");
        const singleEvents = (params as AnyJson).singleEvents !== false;
        qs.set("maxResults", String(Math.min(2500, Math.max(1, maxResults))));
        qs.set("singleEvents", String(singleEvents));
        qs.set("orderBy", singleEvents ? "startTime" : "updated");
        if (timeMin) qs.set("timeMin", timeMin);
        if (timeMax) qs.set("timeMax", timeMax);
        if (q) qs.set("q", q);
        if (pageToken) qs.set("pageToken", pageToken);
        const data = await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      case "get_event": {
        const calendarId = String((params as AnyJson).calendarId || "primary");
        const eventId = String((params as AnyJson).eventId || "");
        if (!eventId) return jsonErr("eventId is required");
        const data = await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
        return jsonOk({ success: true, event: data });
      }

      case "create_event": {
        const calendarId = String((params as AnyJson).calendarId || "primary");
        const eventBody = (params as AnyJson).event as AnyJson;
        if (!eventBody) return jsonErr("event object is required");
        const data = await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
          method: "POST",
          body: JSON.stringify(eventBody),
        });
        return jsonOk({ success: true, event: data });
      }

      case "update_event": {
        const calendarId = String((params as AnyJson).calendarId || "primary");
        const eventId = String((params as AnyJson).eventId || "");
        const eventBody = (params as AnyJson).event as AnyJson;
        if (!eventId) return jsonErr("eventId is required");
        if (!eventBody) return jsonErr("event object is required");
        const data = await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
          method: "PATCH",
          body: JSON.stringify(eventBody),
        });
        return jsonOk({ success: true, event: data });
      }

      case "delete_event": {
        const calendarId = String((params as AnyJson).calendarId || "primary");
        const eventId = String((params as AnyJson).eventId || "");
        if (!eventId) return jsonErr("eventId is required");
        await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
          method: "DELETE",
        });
        return jsonOk({ success: true });
      }

      case "quick_add": {
        const calendarId = String((params as AnyJson).calendarId || "primary");
        const text = String((params as AnyJson).text || "");
        if (!text) return jsonErr("text is required");
        const data = await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/quickAdd?text=${encodeURIComponent(text)}`, {
          method: "POST",
        });
        return jsonOk({ success: true, event: data });
      }

      case "list_colors": {
        const data = await gFetch(token, `${CAL_BASE}/colors`);
        return jsonOk({ success: true, ...data });
      }

      case "watch_events": {
        const calendarId = String((params as AnyJson).calendarId || "primary");
        const webhookUrl = String((params as AnyJson).webhookUrl || "");
        const channelId = String((params as AnyJson).channelId || crypto.randomUUID());
        if (!webhookUrl) return jsonErr("webhookUrl is required");
        const data = await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
          method: "POST",
          body: JSON.stringify({ id: channelId, type: "web_hook", address: webhookUrl }),
        });
        return jsonOk({ success: true, ...data });
      }

      // ============================================================
      // TIER 2: CALENDAR PRO — additive only, existing actions intact
      // ============================================================
      case "freebusy_query": {
        const timeMin = String((params as AnyJson).timeMin || "");
        const timeMax = String((params as AnyJson).timeMax || "");
        const items = (params as AnyJson).calendarIds as string[] | undefined;
        if (!timeMin || !timeMax) return jsonErr("timeMin and timeMax are required");
        const calendarIds = (items && items.length ? items : ["primary"]).map((id) => ({ id }));
        const data = await gFetch(token, `${CAL_BASE}/freeBusy`, {
          method: "POST",
          body: JSON.stringify({ timeMin, timeMax, items: calendarIds }),
        });
        return jsonOk({ success: true, ...data });
      }

      case "find_free_slots": {
        // Computes free slots from freeBusy results within a window.
        const calendarId = String((params as AnyJson).calendarId || "primary");
        const timeMin = String((params as AnyJson).timeMin || "");
        const timeMax = String((params as AnyJson).timeMax || "");
        const durationMins = Number((params as AnyJson).durationMins || 30);
        if (!timeMin || !timeMax) return jsonErr("timeMin and timeMax are required");
        const fb = await gFetch(token, `${CAL_BASE}/freeBusy`, {
          method: "POST",
          body: JSON.stringify({ timeMin, timeMax, items: [{ id: calendarId }] }),
        });
        const cals = (fb.calendars || {}) as Record<string, { busy?: { start: string; end: string }[] }>;
        const busy = cals[calendarId]?.busy || [];
        const winStart = new Date(timeMin).getTime();
        const winEnd = new Date(timeMax).getTime();
        const durMs = durationMins * 60_000;
        const slots: { start: string; end: string }[] = [];
        let cursor = winStart;
        const sortedBusy = [...busy].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
        for (const b of sortedBusy) {
          const bStart = new Date(b.start).getTime();
          const bEnd = new Date(b.end).getTime();
          if (bStart - cursor >= durMs) {
            slots.push({ start: new Date(cursor).toISOString(), end: new Date(bStart).toISOString() });
          }
          cursor = Math.max(cursor, bEnd);
        }
        if (winEnd - cursor >= durMs) {
          slots.push({ start: new Date(cursor).toISOString(), end: new Date(winEnd).toISOString() });
        }
        return jsonOk({ success: true, slots, busy });
      }

      case "move_event": {
        const calendarId = String((params as AnyJson).calendarId || "primary");
        const eventId = String((params as AnyJson).eventId || "");
        const destination = String((params as AnyJson).destination || "");
        if (!eventId || !destination) return jsonErr("eventId and destination are required");
        const data = await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/move?destination=${encodeURIComponent(destination)}`, {
          method: "POST",
        });
        return jsonOk({ success: true, event: data });
      }

      case "list_instances": {
        const calendarId = String((params as AnyJson).calendarId || "primary");
        const eventId = String((params as AnyJson).eventId || "");
        if (!eventId) return jsonErr("eventId is required");
        const qs = new URLSearchParams();
        const timeMin = String((params as AnyJson).timeMin || "");
        const timeMax = String((params as AnyJson).timeMax || "");
        if (timeMin) qs.set("timeMin", timeMin);
        if (timeMax) qs.set("timeMax", timeMax);
        const data = await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/instances?${qs.toString()}`);
        return jsonOk({ success: true, ...data });
      }

      case "respond_to_event": {
        // Update attendee response status (accepted/declined/tentative)
        const calendarId = String((params as AnyJson).calendarId || "primary");
        const eventId = String((params as AnyJson).eventId || "");
        const attendeeEmail = String((params as AnyJson).attendeeEmail || "");
        const responseStatus = String((params as AnyJson).responseStatus || "accepted");
        if (!eventId || !attendeeEmail) return jsonErr("eventId and attendeeEmail are required");
        const current = await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
        const attendees = ((current.attendees as AnyJson[]) || []).map((a) => {
          const ae = a as AnyJson;
          if (String(ae.email || "").toLowerCase() === attendeeEmail.toLowerCase()) {
            return { ...ae, responseStatus };
          }
          return ae;
        });
        const data = await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
          method: "PATCH",
          body: JSON.stringify({ attendees }),
        });
        return jsonOk({ success: true, event: data });
      }

      case "add_attendees": {
        const calendarId = String((params as AnyJson).calendarId || "primary");
        const eventId = String((params as AnyJson).eventId || "");
        const newAttendees = ((params as AnyJson).attendees as string[]) || [];
        if (!eventId || !newAttendees.length) return jsonErr("eventId and attendees[] required");
        const current = await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
        const existing = ((current.attendees as AnyJson[]) || []) as AnyJson[];
        const merged = [...existing];
        for (const email of newAttendees) {
          if (!existing.some((a) => String((a as AnyJson).email || "").toLowerCase() === email.toLowerCase())) {
            merged.push({ email });
          }
        }
        const data = await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
          method: "PATCH",
          body: JSON.stringify({ attendees: merged }),
        });
        return jsonOk({ success: true, event: data });
      }

      case "create_event_with_meet": {
        // Creates an event WITH a Google Meet conference link
        const calendarId = String((params as AnyJson).calendarId || "primary");
        const eventBody = (params as AnyJson).event as AnyJson;
        if (!eventBody) return jsonErr("event object is required");
        const requestId = `meet-${crypto.randomUUID()}`;
        const enriched = {
          ...eventBody,
          conferenceData: {
            createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } },
          },
        };
        const data = await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1`, {
          method: "POST",
          body: JSON.stringify(enriched),
        });
        return jsonOk({ success: true, event: data });
      }

      case "create_calendar": {
        const summary = String((params as AnyJson).summary || "");
        const timeZone = String((params as AnyJson).timeZone || "UTC");
        if (!summary) return jsonErr("summary is required");
        const data = await gFetch(token, `${CAL_BASE}/calendars`, {
          method: "POST",
          body: JSON.stringify({ summary, timeZone }),
        });
        return jsonOk({ success: true, calendar: data });
      }

      case "delete_calendar": {
        const calendarId = String((params as AnyJson).calendarId || "");
        if (!calendarId || calendarId === "primary") return jsonErr("Cannot delete primary; calendarId required");
        await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}`, { method: "DELETE" });
        return jsonOk({ success: true });
      }

      case "set_event_reminders": {
        const calendarId = String((params as AnyJson).calendarId || "primary");
        const eventId = String((params as AnyJson).eventId || "");
        const reminderMinutes = ((params as AnyJson).reminderMinutes as number[]) || [];
        const method = String((params as AnyJson).method || "popup"); // popup | email
        if (!eventId) return jsonErr("eventId is required");
        const reminders = {
          useDefault: false,
          overrides: reminderMinutes.map((m) => ({ method, minutes: m })),
        };
        const data = await gFetch(token, `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
          method: "PATCH",
          body: JSON.stringify({ reminders }),
        });
        return jsonOk({ success: true, event: data });
      }

      default:
        return jsonErr(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error("[google-calendar] error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return jsonErr(msg, 500);
  }
});
