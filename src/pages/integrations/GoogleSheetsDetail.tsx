import { FileSpreadsheet } from "lucide-react";
import { GoogleServiceDetail } from "@/components/integrations/GoogleServiceDetail";

export default function GoogleSheetsDetail() {
  return (
    <GoogleServiceDetail
      config={{
        serviceId: "google-sheets",
        name: "Google Sheets",
        description: "Read and write spreadsheet data programmatically.",
        icon: FileSpreadsheet,
        fnName: "google-sheets",
        testAction: "list_spreadsheets",
        testLabel: "Spreadsheets",
      }}
    />
  );
}
