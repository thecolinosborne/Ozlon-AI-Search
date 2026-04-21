import { Search } from "lucide-react";
import { GoogleServiceDetail } from "@/components/integrations/GoogleServiceDetail";

export default function GoogleSearchConsoleDetail() {
  return (
    <GoogleServiceDetail
      config={{
        serviceId: "google-search-console",
        name: "Search Console",
        description: "Pull SEO performance data for verified properties.",
        icon: Search,
        fnName: "google-search-console",
        testAction: "list_sites",
        testLabel: "Verified Sites",
      }}
    />
  );
}
