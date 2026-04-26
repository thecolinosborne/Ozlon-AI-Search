// Scheduled Routines dispatcher
// Two modes:
//  1. ?mode=tick  -> called by pg_cron every minute. Finds due routines and fires them.
//  2. ?mode=run&routine_id=... -> executes a specific routine immediately.
// Default (POST with body): same as run, used for manual "Run now" from UI.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

// --- Tiny cron matcher (minute precision, supports * and comma lists and */N) ---
function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [m, h, dom, mon, dow] = parts;
  const fields = [
    [m, date.getUTCMinutes(), 0, 59],
    [h, date.getUTCHours(), 0, 23],
    [dom, date.getUTCDate(), 1, 31],
    [mon, date.getUTCMonth() + 1, 1, 12],
    [dow, date.getUTCDay(), 0, 6],
  ] as const;
  for (const [field, value, min, max] of fields) {
    if (!matchField(String(field), value as number, min, max)) return false;
  }
  return true;
}

function matchField(field: string, value: number, min: number, max: number): boolean {
  if (field === "*") return true;
  for (const part of field.split(",")) {
    if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2), 10);
      if (step > 0 && (value - min) % step === 0) return true;
    } else if (part.includes("-")) {
      const [a, b] = part.split("-").map((n) => parseInt(n, 10));
      if (value >= a && value <= b) return true;
    } else {
      if (parseInt(part, 10) === value) return true;
    }
  }
  return false;
}

async function runRoutine(routineId: string, triggeredBy = "cron") {
  const { data: routine, error: rErr } = await admin
    .from("scheduled_routines")
    .select("*")
    .eq("id", routineId)
    .maybeSingle();

  if (rErr || !routine) {
    console.error("[routines] routine not found", routineId, rErr);
    return { success: false, error: "Routine not found" };
  }

  // Create a run record
  const { data: run } = await admin
    .from("routine_runs")
    .insert({
      routine_id: routine.id,
      user_id: routine.user_id,
      status: "running",
      triggered_by: triggeredBy,
    })
    .select("id")
    .single();

  const startTime = Date.now();

  try {
    // Call the chat function with the routine prompt and tools enabled
    const chatRes = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE}`,
        apikey: ANON_KEY,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: routine.prompt }],
        userId: routine.user_id,
        enableTools: true,
        systemContext: `You are executing a scheduled routine named "${routine.name}". Follow the user's prompt exactly and return a clear, well-formatted report. Use any tools you need.`,
      }),
    });

    const chatJson = await chatRes.json().catch(() => ({}));
    const output: string =
      chatJson?.message ||
      chatJson?.content ||
      chatJson?.choices?.[0]?.message?.content ||
      JSON.stringify(chatJson).slice(0, 4000);

    const duration = Date.now() - startTime;

    await admin
      .from("routine_runs")
      .update({
        status: chatRes.ok ? "completed" : "failed",
        output,
        error_message: chatRes.ok ? null : `Chat returned ${chatRes.status}`,
        duration_ms: duration,
        completed_at: new Date().toISOString(),
      })
      .eq("id", run!.id);

    await admin
      .from("scheduled_routines")
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: chatRes.ok ? "completed" : "failed",
        run_count: (routine.run_count ?? 0) + 1,
      })
      .eq("id", routine.id);

    return { success: chatRes.ok, runId: run!.id, output };
  } catch (err) {
    const duration = Date.now() - startTime;
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[routines] run error", msg);

    await admin
      .from("routine_runs")
      .update({
        status: "failed",
        error_message: msg,
        duration_ms: duration,
        completed_at: new Date().toISOString(),
      })
      .eq("id", run!.id);

    await admin
      .from("scheduled_routines")
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: "failed",
      })
      .eq("id", routine.id);

    return { success: false, error: msg, runId: run!.id };
  }
}

async function tick() {
  const now = new Date();
  // Truncate to current minute (UTC) so we don't double-fire
  const { data: routines } = await admin
    .from("scheduled_routines")
    .select("id, cron_expression, last_run_at")
    .eq("active", true);

  if (!routines || routines.length === 0) return { fired: 0 };

  let fired = 0;
  for (const r of routines) {
    if (!cronMatches(r.cron_expression, now)) continue;
    // Skip if we already ran this minute
    if (r.last_run_at) {
      const last = new Date(r.last_run_at);
      if (
        last.getUTCFullYear() === now.getUTCFullYear() &&
        last.getUTCMonth() === now.getUTCMonth() &&
        last.getUTCDate() === now.getUTCDate() &&
        last.getUTCHours() === now.getUTCHours() &&
        last.getUTCMinutes() === now.getUTCMinutes()
      ) {
        continue;
      }
    }
    // Fire and forget
    runRoutine(r.id, "cron").catch((e) =>
      console.error("[routines] background error", e),
    );
    fired++;
  }
  return { fired };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") ?? "run";

    if (mode === "tick") {
      const result = await tick();
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Phase B: signals lookahead tick — fans out to signals-synthesize for each
    // recently-active user. Cron should call this every ~30 minutes.
    if (mode === "signals_lookahead_tick") {
      const cronKey = Deno.env.get("SIGNALS_CRON_KEY") ?? SERVICE_ROLE;
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/signals-synthesize?mode=lookahead_tick`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_ROLE}`,
            apikey: ANON_KEY,
            "x-cron-key": cronKey,
          },
        },
      );
      const body = await res.json().catch(() => ({}));
      return new Response(JSON.stringify({ forwarded: true, status: res.status, ...body }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Phase E: signals tuning tick — outcome-driven salience floors + decay.
    if (mode === "signals_tune_tick") {
      const cronKey = Deno.env.get("SIGNALS_CRON_KEY") ?? SERVICE_ROLE;
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/signals-tune?mode=tick`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_ROLE}`,
            apikey: ANON_KEY,
            "x-cron-key": cronKey,
          },
        },
      );
      const body = await res.json().catch(() => ({}));
      return new Response(JSON.stringify({ forwarded: true, status: res.status, ...body }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Daily Digest tick — fans out cross-integration brief to active users.
    if (mode === "signals_daily_digest_tick") {
      const cronKey = Deno.env.get("SIGNALS_CRON_KEY") ?? SERVICE_ROLE;
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/signals-synthesize?mode=daily_digest_tick`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_ROLE}`,
            apikey: ANON_KEY,
            "x-cron-key": cronKey,
          },
        },
      );
      const body = await res.json().catch(() => ({}));
      return new Response(JSON.stringify({ forwarded: true, status: res.status, ...body }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Manual run: requires routine_id (from query or body)
    let routineId = url.searchParams.get("routine_id");
    if (!routineId && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      routineId = body.routine_id ?? body.routineId ?? null;
    }
    if (!routineId) {
      return new Response(JSON.stringify({ error: "routine_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await runRoutine(routineId, "manual");
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
