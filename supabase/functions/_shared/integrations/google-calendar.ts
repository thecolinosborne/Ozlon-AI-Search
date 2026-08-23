import type { IntegrationManifest } from "./types.ts";

export const googleCalendarIntegration: IntegrationManifest = {
  id: "google-calendar",
  displayName: "Google Calendar",
  edgeFunction: "google-calendar",
  envelope: "nested",
  tools: [
    {
      name: "calendar_list_calendars",
      description: "List all calendars the user has access to.",
      action: "list_calendars",
      schema: { type: "object", properties: {} },
    },
    {
      name: "calendar_list_events",
      description: "List events on a calendar between two times.",
      action: "list_events",
      schema: {
        type: "object",
        properties: {
          calendarId: { type: "string", description: "Default 'primary'" },
          timeMin: { type: "string", description: "ISO start time" },
          timeMax: { type: "string", description: "ISO end time" },
          q: { type: "string" },
          maxResults: { type: "number" },
        },
      },
      mapArgs: (a) => ({ calendarId: a.calendarId ?? "primary", timeMin: a.timeMin, timeMax: a.timeMax, q: a.q, maxResults: a.maxResults }),
    },
    {
      name: "calendar_create_event",
      description:
        "Create a calendar event with structured fields. PREFER THIS over calendar_quick_add whenever you know the exact times, or need a description, location, or color. Never put description/colorId/location text inside a title.",
      action: "create_event",
      schema: {
        type: "object",
        properties: {
          calendarId: { type: "string", description: "Default 'primary'" },
          summary: { type: "string", description: "Short event title only — no metadata" },
          description: { type: "string" },
          location: { type: "string" },
          colorId: { type: "string", description: "Google Calendar color id, '1'-'11'" },
          start_time: { type: "string", description: "ISO start dateTime" },
          end_time: { type: "string", description: "ISO end dateTime" },
          all_day_date: { type: "string", description: "YYYY-MM-DD for an all-day event (instead of start/end times)" },
          attendees: { type: "string", description: "Comma-separated emails" },
        },
        required: ["summary"],
      },
      mapArgs: (a) => {
        const attendees = typeof a.attendees === "string"
          ? (a.attendees as string).split(",").map((e) => e.trim()).filter(Boolean).map((email) => ({ email }))
          : a.attendees;
        const start = a.all_day_date ? { date: a.all_day_date } : { dateTime: a.start_time };
        const end = a.all_day_date ? { date: a.all_day_date } : { dateTime: a.end_time };
        return {
          calendarId: a.calendarId ?? "primary",
          event: {
            summary: a.summary,
            description: a.description,
            location: a.location,
            colorId: a.colorId ? String(a.colorId) : undefined,
            start,
            end,
            attendees,
          },
        };
      },
    },
    {
      name: "calendar_update_event",
      description:
        "Update an existing calendar event (rename, retime, set description/location/color). If the event lives on a secondary calendar or the id is stale, the backend auto-resolves it across all calendars — pass match_title with the event's current title to help.",
      action: "update_event",
      schema: {
        type: "object",
        properties: {
          calendarId: { type: "string" },
          eventId: { type: "string" },
          match_title: { type: "string", description: "Current event title, used to re-find the event if the id is stale" },
          summary: { type: "string" },
          description: { type: "string" },
          location: { type: "string" },
          colorId: { type: "string" },
          start_time: { type: "string" },
          end_time: { type: "string" },
        },
        required: ["eventId"],
      },
      mapArgs: (a) => {
        const event: Record<string, unknown> = {};
        if (a.summary !== undefined) event.summary = a.summary;
        if (a.description !== undefined) event.description = a.description;
        if (a.location !== undefined) event.location = a.location;
        if (a.colorId !== undefined) event.colorId = String(a.colorId);
        if (a.start_time) event.start = { dateTime: a.start_time };
        if (a.end_time) event.end = { dateTime: a.end_time };
        return { calendarId: a.calendarId ?? "primary", eventId: a.eventId, summary: a.match_title, event };
      },
    },
    {
      name: "calendar_quick_add",
      description:
        "Create an event from a short natural-language phrase ONLY (e.g. 'Lunch with Sam tomorrow 1pm'). Do NOT embed description, location, or colorId inside the text — pass them as separate fields, or use calendar_create_event instead.",
      action: "quick_add",
      schema: {
        type: "object",
        properties: {
          calendarId: { type: "string" },
          text: { type: "string", description: "Natural-language title + time only" },
          description: { type: "string" },
          location: { type: "string" },
          colorId: { type: "string", description: "'1'-'11'" },
        },
        required: ["text"],
      },
      mapArgs: (a) => ({
        calendarId: a.calendarId ?? "primary",
        text: a.text,
        description: a.description,
        location: a.location,
        colorId: a.colorId ? String(a.colorId) : undefined,
      }),
    },

    {
      name: "calendar_create_event_with_meet",
      description: "Create a calendar event with an attached Google Meet link.",
      action: "create_event_with_meet",
      schema: {
        type: "object",
        properties: {
          calendarId: { type: "string" },
          summary: { type: "string" },
          description: { type: "string" },
          start_time: { type: "string", description: "ISO start dateTime" },
          end_time: { type: "string", description: "ISO end dateTime" },
          attendees: { type: "string", description: "Comma-separated emails" },
        },
        required: ["summary", "start_time", "end_time"],
      },
      mapArgs: (a) => {
        const attendees = typeof a.attendees === "string"
          ? (a.attendees as string).split(",").map((e) => e.trim()).filter(Boolean).map((email) => ({ email }))
          : a.attendees;
        return {
          calendarId: a.calendarId ?? "primary",
          event: {
            summary: a.summary,
            description: a.description,
            start: { dateTime: a.start_time },
            end: { dateTime: a.end_time },
            attendees,
          },
        };
      },
    },
    {
      name: "calendar_delete_event",
      description: "Delete a calendar event by ID. Auto-resolves the event across all of the user's calendars; pass match_title if the id may be stale.",
      action: "delete_event",
      schema: {
        type: "object",
        properties: {
          calendarId: { type: "string" },
          eventId: { type: "string" },
          match_title: { type: "string", description: "Current event title, used to re-find the event if the id is stale" },
        },
        required: ["eventId"],
      },
      mapArgs: (a) => ({ calendarId: a.calendarId ?? "primary", eventId: a.eventId, summary: a.match_title }),
    },
    {
      name: "calendar_freebusy",
      description: "Query free/busy windows across one or more calendars.",
      action: "freebusy_query",
      schema: {
        type: "object",
        properties: {
          timeMin: { type: "string" },
          timeMax: { type: "string" },
          calendarIds: { type: "array", items: { type: "string" } },
        },
        required: ["timeMin", "timeMax"],
      },
      mapArgs: (a) => ({ timeMin: a.timeMin, timeMax: a.timeMax, calendarIds: a.calendarIds }),
    },
  ],
};
