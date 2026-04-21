import { FileText } from "lucide-react";
import { GoogleServiceDetail } from "@/components/integrations/GoogleServiceDetail";

export default function GoogleDocsDetail() {
  return (
    <GoogleServiceDetail
      config={{
        serviceId: "google-docs",
        name: "Google Docs",
        description: "Create and edit Google Documents.",
        icon: FileText,
        fnName: "google-docs",
        testAction: "list_documents",
        testLabel: "Documents",
      }}
    />
  );
}
