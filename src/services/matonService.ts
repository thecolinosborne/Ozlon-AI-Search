export interface MatonConnection {
  app: string;
  connection_id: string;
  status: string;
  method: string;
  url?: string;
  metadata?: Record<string, unknown>;
  creation_time: string;
  last_updated_time: string;
}

const MATON_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/maton`;

export async function fetchMatonConnections(): Promise<MatonConnection[]> {
  console.log("Fetching Maton connections via direct fetch...");
  
  const response = await fetch(MATON_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ action: "connections" }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    console.error("Maton fetch failed:", response.status, errorData);
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  const data = await response.json();
  console.log("Maton connections loaded:", data?.connections?.length ?? 0);
  return data?.connections || [];
}

export function formatAppName(app: string): string {
  return app
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
