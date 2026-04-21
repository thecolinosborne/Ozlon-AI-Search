import { Mail } from "lucide-react";
import { GoogleServiceDetail } from "@/components/integrations/GoogleServiceDetail";

export default function GmailDetail() {
  return (
    <GoogleServiceDetail
      config={{
        serviceId: "gmail",
        name: "Gmail",
        description: "Read, search, send, and manage email via your Google account.",
        icon: Mail,
        fnName: "google-gmail",
        testAction: "get_profile",
        testLabel: "Gmail Profile",
        scopeNote: "Requires gmail.modify scope (granted via shared Workspace OAuth).",
      }}
    />
  );
}
