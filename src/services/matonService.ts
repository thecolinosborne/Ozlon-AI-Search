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
  const { data, error } = await supabase.functions.invoke("maton", {
    body: { action: "connections" },
  });

  if (error) throw new Error(error.message);
  return data?.connections || [];
}

export function formatAppName(app: string): string {
  return app
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
