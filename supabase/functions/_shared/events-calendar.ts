// Discovered events <-> Google Calendar sync.
// Used by the chat tools and the `events-calendar` edge function so both paths
// behave identically: correct local time, no duplicates, update in place,
// and every result is recorded back on the saved event.

type Row = Record<string, unknown>;
export type CalCall = (action: string, params: Row) => Promise<Row>;

const DEFAULT_TZ = "America/New_York";

/** Offset (minutes) of an IANA zone at a given instant. */
function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Treat a wall-clock "YYYY-MM-DDTHH:mm" as local time in tz; return the real instant. */
export function wallClockToInstant(wall: string, tz: string): Date | null {
  const m = wall.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const off = tzOffsetMinutes(tz, new Date(guess));
  return new Date(guess - off * 60000);
}

/**
 * Normalize a date the extractor returned. Strings with an explicit offset are
 * trusted; bare wall-clock strings are read as local time in the event's zone
 * (the old code read them as UTC, which put events hours off on the calendar).
 */
export function normalizeEventDate(raw: unknown, tz?: string | null): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim();
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = wallClockToInstant(s, tz || DEFAULT_TZ);
  return d ? d.toISOString() : null;
}

/** Stored rows saved before the fix have no timezone and a UTC time that was really local. */
function startEnd(e: Row): { start: Date; end: Date; tz: string; allDay: boolean } {
  const tz = (e.timezone as string) || DEFAULT_TZ;
  const legacy = !e.timezone;
  const fix = (v: string) => {
    if (!legacy) return new Date(v);
    const utcWall = new Date(v).toISOString().slice(0, 19);
    return wallClockToInstant(utcWall, tz) || new Date(v);
  };
  const start = fix(String(e.event_date));
  let end = e.end_date ? fix(String(e.end_date)) : new Date(start.getTime() + 2 * 3600_000);
  if (end <= start) end = new Date(start.getTime() + 2 * 3600_000);
  const localStart = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(start);
  const allDay = localStart === "00:00" && (end.getTime() - start.getTime()) >= 20 * 3600_000;
  return { start, end, tz, allDay };
}

function localDate(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function costLabel(e: Row) {
  if (e.is_free === true) return "Free";
  if (e.cost_text) return String(e.cost_text);
  if (e.cost_min != null) return `$${e.cost_min}${e.cost_max != null && e.cost_max !== e.cost_min ? `–$${e.cost_max}` : ""}`;
  return "Price not listed";
}

export function buildCalendarBody(e: Row) {
  const { start, end, tz, allDay } = startEnd(e);
  const cost = costLabel(e);
  const desc = [
    e.description as string,
    "",
    `Cost: ${cost}`,
    e.ticket_notes ? `Ticket notes: ${e.ticket_notes}` : "",
    e.organizer ? `Host: ${e.organizer}` : "",
    e.rsvp_deadline ? `RSVP by: ${new Date(String(e.rsvp_deadline)).toDateString()}` : "",
    e.registration_url ? `Tickets: ${e.registration_url}` : "",
    e.url && e.url !== e.registration_url ? `Details: ${e.url}` : "",
  ].filter((l) => l !== undefined && l !== null && l !== false).join("\n").replace(/\n{3,}/g, "\n\n").trim();

  const endDay = new Date(end.getTime() + 24 * 3600_000); // Google all-day end is exclusive
  return {
    body: {
      summary: String(e.title || "Event"),
      description: desc,
      location: [e.venue_name, e.address].filter(Boolean).join(", ") || (e.location as string) || undefined,
      start: allDay ? { date: localDate(start, tz) } : { dateTime: start.toISOString(), timeZone: tz },
      end: allDay ? { date: localDate(endDay, tz) } : { dateTime: end.toISOString(), timeZone: tz },
      source: (e.registration_url || e.url)
        ? { title: String(e.organizer || e.source || "Event page"), url: String(e.registration_url || e.url) }
        : undefined,
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 1440 }, { method: "popup", minutes: 60 }] },
    },
    start, end, tz, cost,
  };
}

/** Look for the same event already on the calendar (same title, same day). */
async function findExisting(cal: CalCall, calendarId: string, title: string, start: Date): Promise<string | null> {
  try {
    const res = await cal("list_events", {
      calendarId, q: title.slice(0, 60),
      timeMin: new Date(start.getTime() - 12 * 3600_000).toISOString(),
      timeMax: new Date(start.getTime() + 36 * 3600_000).toISOString(),
      maxResults: 10,
    });
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const hit = ((res.items as Row[]) || []).find((i) => norm(String(i.summary || "")) === norm(title));
    return hit?.id ? String(hit.id) : null;
  } catch { return null; }
}

export interface SyncLine { id: string; title: string; status: "added" | "updated" | "linked" | "skipped" | "failed"; detail: string; calendar_event_id?: string | null }

// deno-lint-ignore no-explicit-any
export async function addEventsToCalendar(admin: any, userId: string, cal: CalCall, rows: Row[], opts: { calendarId?: string; force?: boolean } = {}): Promise<SyncLine[]> {
  const out: SyncLine[] = [];
  for (const e of rows) {
    const id = String(e.id), title = String(e.title || "Event");
    if (!e.event_date) { out.push({ id, title, status: "skipped", detail: "no confirmed date yet" }); continue; }
    const calendarId = (opts.calendarId || (e.calendar_id as string) || "primary");
    const { body, start, tz, cost } = buildCalendarBody(e);
    const when = start.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz });
    try {
      let evId = (e.calendar_event_id as string) || null;
      let status: SyncLine["status"] = "added";
      if (evId) {
        // Update in place (fixes old entries with wrong time or dead links) instead of duplicating.
        try {
          const r = await cal("update_event", { calendarId, eventId: evId, summary: title, event: body });
          evId = String((r.event as Row)?.id || evId);
          status = "updated";
        } catch { evId = null; }
      }
      if (!evId) {
        const existing = await findExisting(cal, calendarId, title, start);
        if (existing) {
          const r = await cal("update_event", { calendarId, eventId: existing, event: body });
          evId = String((r.event as Row)?.id || existing);
          status = "linked";
        } else {
          const r = await cal("create_event", { calendarId, event: body });
          evId = ((r.event as Row)?.id as string) || null;
          if (!evId) throw new Error("Google Calendar did not return an event id");
        }
      }
      const { error } = await admin.from("discovered_events").update({
        calendar_event_id: evId, calendar_id: calendarId, added_to_calendar_at: new Date().toISOString(),
        timezone: tz,
      }).eq("id", id).eq("user_id", userId);
      if (error) console.warn("[events-calendar] save link failed:", error.message);
      out.push({ id, title, status, detail: `${when} · ${cost}`, calendar_event_id: evId });
    } catch (err) {
      out.push({ id, title, status: "failed", detail: err instanceof Error ? err.message.slice(0, 300) : "calendar error" });
    }
  }
  return out;
}

// deno-lint-ignore no-explicit-any
export async function removeEventsFromCalendar(admin: any, userId: string, cal: CalCall, rows: Row[]): Promise<SyncLine[]> {
  const out: SyncLine[] = [];
  for (const e of rows) {
    const id = String(e.id), title = String(e.title || "Event");
    if (!e.calendar_event_id) { out.push({ id, title, status: "skipped", detail: "not on calendar" }); continue; }
    try {
      await cal("delete_event", { calendarId: (e.calendar_id as string) || "primary", eventId: e.calendar_event_id, summary: title });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!/404|410|not found/i.test(msg)) { out.push({ id, title, status: "failed", detail: msg.slice(0, 300) }); continue; }
    }
    await admin.from("discovered_events").update({ calendar_event_id: null, added_to_calendar_at: null }).eq("id", id).eq("user_id", userId);
    out.push({ id, title, status: "updated", detail: "removed from calendar" });
  }
  return out;
}

export function formatSyncLines(lines: SyncLine[]): string {
  const verb: Record<SyncLine["status"], string> = { added: "Added", updated: "Updated", linked: "Already there, refreshed", skipped: "Skipped", failed: "Failed" };
  return lines.map((l) => `- ${verb[l.status]} **${l.title}** — ${l.detail}`).join("\n");
}
