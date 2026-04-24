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
        scopeNote: "Full Gmail management: read, send, modify, compose drafts, manage labels, filters, signature, and vacation responder. Deletion uses trash (Gmail auto-purges after 30 days)."
      }}
    />
  );
}
