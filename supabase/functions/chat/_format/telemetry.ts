// Formatting Engine 2026 — Phase 3 telemetry sink.
// Fire-and-forget insert into public.formatting_telemetry. Never throws.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export interface TelemetryRow {
  user_id?: string | null;
  session_id?: string | null;
  mode: string;
  router_reason?: string | null;
  path: "stream" | "tools";
  user_text_len?: number | null;
  output_chars?: number | null;
  verifier_op_mode?: string | null;
  verifier_ok?: boolean | null;
  verifier_issues?: unknown;
  verifier_latency_ms?: number | null;
  verifier_model?: string | null;
  verifier_skipped?: string | null;
  verifier_repaired?: boolean | null;
  longform_kind?: string | null;
  longform_target_words?: number | null;
}

let cachedAdmin: ReturnType<typeof createClient> | null = null;
function getAdmin() {
  if (cachedAdmin) return cachedAdmin;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  cachedAdmin = createClient(url, key);
  return cachedAdmin;
}

export function recordFormattingTelemetry(row: TelemetryRow): void {
  if (Deno.env.get("FORMAT_TELEMETRY_DISABLED") === "1") return;
  try {
    const admin = getAdmin();
    if (!admin) return;
    admin
      .from("formatting_telemetry")
      .insert(row as any)
      .then(({ error }) => {
        if (error) console.warn("[FormatTelemetry] insert error:", error.message);
      });
  } catch (e) {
    console.warn("[FormatTelemetry] sink error:", (e as Error).message);
  }
}
