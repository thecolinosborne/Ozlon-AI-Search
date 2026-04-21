import { Presentation } from "lucide-react";
import { GoogleServiceDetail } from "@/components/integrations/GoogleServiceDetail";

export default function GoogleSlidesDetail() {
  return (
    <GoogleServiceDetail
      config={{
        serviceId: "google-slides",
        name: "Google Slides",
        description: "Create and edit Google Slides presentations.",
        icon: Presentation,
        fnName: "google-slides",
        testAction: "list_presentations",
        testLabel: "Presentations",
      }}
    />
  );
}
