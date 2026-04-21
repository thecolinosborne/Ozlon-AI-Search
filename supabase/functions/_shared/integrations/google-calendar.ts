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
      name: "calendar_quick_add",
      description: "Create a calendar event from natural language ('Lunch with Sam tomorrow 1pm').",
      action: "quick_add",
      schema: {
        type: "object",
        properties: { calendarId: { type: "string" }, text: { type: "string" } },
        required: ["text"],
      },
      mapArgs: (a) => ({ calendarId: a.calendarId ?? "primary", text: a.text }),
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
      description: "Delete a calendar event by ID.",
      action: "delete_event",
      schema: {
        type: "object",
        properties: { calendarId: { type: "string" }, eventId: { type: "string" } },
        required: ["eventId"],
      },
      mapArgs: (a) => ({ calendarId: a.calendarId ?? "primary", eventId: a.eventId }),
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
