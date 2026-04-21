import { Tag } from "lucide-react";
import { GoogleServiceDetail } from "@/components/integrations/GoogleServiceDetail";

export default function GoogleTagManagerDetail() {
  return (
    <GoogleServiceDetail
      config={{
        serviceId: "google-tag-manager",
        name: "Tag Manager",
        description: "Manage GTM containers, tags, and triggers.",
        icon: Tag,
        fnName: "google-tag-manager",
        testAction: "list_accounts",
        testLabel: "GTM Accounts",
      }}
    />
  );
}
