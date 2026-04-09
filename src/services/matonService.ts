import { supabase } from "@/integrations/supabase/client";

export interface MatonConnection {
  app: string;
  connection_id: string;
  status: string;
  method: string;
  metadata?: Record<string, unknown>;
  creation_time: string;
  last_updated_time: string;
}

export async function fetchMatonConnections(): Promise<MatonConnection[]> {
  console.log("Fetching Maton connections...");
  const { data, error } = await supabase.functions.invoke("maton", {
    body: { action: "connections" },
  });

  if (error) {
    console.error("Maton service error:", error);
    throw new Error(error.message || "Failed to fetch Maton connections");
  }
  
  console.log("Maton connections loaded:", data?.connections?.length ?? 0);
  return data?.connections || [];
}

export function formatAppName(app: string): string {
  return app
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
