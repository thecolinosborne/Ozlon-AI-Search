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

      default:
        return jsonErr(`Unknown action: ${action}`);
    }
  } catch (err) {
    console.error("[google-calendar] error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return jsonErr(msg, 500);
  }
});
