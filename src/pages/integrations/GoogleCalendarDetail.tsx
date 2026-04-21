import { Calendar } from "lucide-react";
import { GoogleServiceDetail } from "@/components/integrations/GoogleServiceDetail";

export default function GoogleCalendarDetail() {
  return (
    <GoogleServiceDetail
      config={{
        serviceId: "google-calendar",
        name: "Google Calendar",
        description: "View, create, and manage calendar events.",
        icon: Calendar,
        fnName: "google-calendar",
        testAction: "list_calendars",
        testLabel: "Calendars",
      }}
    />
  );
}
