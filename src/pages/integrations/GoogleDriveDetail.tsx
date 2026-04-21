import { HardDrive } from "lucide-react";
import { GoogleServiceDetail } from "@/components/integrations/GoogleServiceDetail";

export default function GoogleDriveDetail() {
  return (
    <GoogleServiceDetail
      config={{
        serviceId: "google-drive",
        name: "Google Drive",
        description: "Browse, upload, and manage files in your Google Drive.",
        icon: HardDrive,
        fnName: "google-drive",
        testAction: "get_storage_quota",
        testLabel: "Storage Quota",
      }}
    />
  );
}
