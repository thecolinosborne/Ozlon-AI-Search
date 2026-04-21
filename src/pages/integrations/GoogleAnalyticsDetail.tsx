import { BarChart3 } from "lucide-react";
import { GoogleServiceDetail } from "@/components/integrations/GoogleServiceDetail";

export default function GoogleAnalyticsDetail() {
  return (
    <GoogleServiceDetail
      config={{
        serviceId: "google-analytics",
        name: "Google Analytics",
        description: "Query GA4 properties for traffic and conversion data.",
        icon: BarChart3,
        fnName: "google-analytics",
        testAction: "list_accounts",
        testLabel: "GA4 Accounts",
      }}
    />
  );
}
