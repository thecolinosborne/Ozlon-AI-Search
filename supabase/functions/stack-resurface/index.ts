// Stack — Phase 3 cron resurfacer.
// Runs every 5 minutes. Two jobs:
//   1) Clear `snoozed_until` on rows whose snooze has expired (so they reappear).
//   2) Bump salience on items with `due_at` within the next hour so they rank up.
// Idempotent and safe to re-run. Uses service role to bypass RLS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return new Response(JSON.stringify({ error: "missing env" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(url, key);
  const nowIso = new Date().toISOString();
  const inOneHour = new Date(Date.now() + 60 * 60_000).toISOString();
  const result: Record<string, unknown> = { ran_at: nowIso };

  try {
    // 1) Resurface expired snoozes: blank `snoozed_until` so the client query picks them up again.
    const { data: resurfaced, error: e1 } = await supabase
      .from("signal_moments")
      .update({ snoozed_until: null })
      .eq("status", "live")
      .not("snoozed_until", "is", null)
      .lte("snoozed_until", nowIso)
      .select("id");
    if (e1) throw e1;
    result.resurfaced = resurfaced?.length ?? 0;

    // 2) Bump salience for items due within the next hour (clamped to 1.0).
    const { data: dueSoon, error: e2 } = await supabase
      .from("signal_moments")
      .select("id, salience")
      .eq("status", "live")
      .not("due_at", "is", null)
      .gte("due_at", nowIso)
      .lte("due_at", inOneHour);
    if (e2) throw e2;

    let bumped = 0;
    for (const row of dueSoon ?? []) {
      const next = Math.min(1, Number(row.salience ?? 0.5) + 0.1);
      const { error } = await supabase
        .from("signal_moments")
        .update({ salience: next })
        .eq("id", row.id);
      if (!error) bumped++;
    }
    result.bumped_due_soon = bumped;

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
