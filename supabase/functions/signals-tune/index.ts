// signals-tune — Phase E.
// Outcome-driven salience tuning + decay pass for the Signals layer.
//
// For each recently-active user:
//   1. Aggregate last 14d of signal_moments by `kind` → act / ignore / dismiss counts.
//   2. Derive a per-kind salience_floor:
//        ignored_ratio > 0.7  → raise floor toward 0.85 (suppress noise)
//        acted_ratio   > 0.5  → lower floor toward 0.45 (let more through)
//        otherwise            → 0.6 baseline
//   3. Upsert ONE wisdom_memories row per user: memory_type='signal_tuning',
//      content = JSON map { [kind]: { floor, acted, ignored, dismissed, sample_size } }.
//      signals-synthesize reads this and enforces floors per kind.
//   4. Decay: live signals older than 2h have salience multiplied by 0.7.
//      Live signals with salience < 0.25 are expired.
//
// Auth:
//   - cron path (mode=tick) requires `x-cron-key` matching SIGNALS_CRON_KEY env
//     (defaults to service role) — same pattern as signals-synthesize lookahead.
//   - per-user path uses Bearer JWT for ad-hoc tuning from UI.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CRON_KEY = Deno.env.get("SIGNALS_CRON_KEY") ?? SERVICE_ROLE;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const BASELINE_FLOOR = 0.6;
const NOISY_FLOOR = 0.85;
const TRUSTED_FLOOR = 0.45;
const MIN_SAMPLE = 4; // need at least 4 outcomes for a kind to tune

interface KindTuning {
  floor: number;
  acted: number;
  ignored: number;
  dismissed: number;
  sample_size: number;
}

async function resolveUser(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

async function tuneUser(userId: string) {
  // 1. Aggregate outcomes per kind over last 14d.
  const since = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
  const { data: moments } = await admin
    .from("signal_moments")
    .select("kind, status")
    .eq("user_id", userId)
    .gte("created_at", since)
    .in("status", ["acted", "ignored", "dismissed", "expired"]);

  const buckets = new Map<string, { acted: number; ignored: number; dismissed: number }>();
  for (const m of (moments ?? []) as Array<{ kind: string; status: string }>) {
    if (!m.kind) continue;
    const b = buckets.get(m.kind) ?? { acted: 0, ignored: 0, dismissed: 0 };
    if (m.status === "acted") b.acted++;
    else if (m.status === "ignored" || m.status === "expired") b.ignored++;
    else if (m.status === "dismissed") b.dismissed++;
    buckets.set(m.kind, b);
  }

  const tuning: Record<string, KindTuning> = {};
  for (const [kind, b] of buckets) {
    const total = b.acted + b.ignored + b.dismissed;
    if (total < MIN_SAMPLE) continue;
    const ignoredRatio = (b.ignored + b.dismissed) / total;
    const actedRatio = b.acted / total;
    let floor = BASELINE_FLOOR;
    if (ignoredRatio > 0.7) floor = NOISY_FLOOR;
    else if (actedRatio > 0.5) floor = TRUSTED_FLOOR;
    tuning[kind] = {
      floor,
      acted: b.acted,
      ignored: b.ignored,
      dismissed: b.dismissed,
      sample_size: total,
    };
  }

  // 2. Upsert single signal_tuning wisdom row (idempotent — match by memory_type).
  const tuningContent = JSON.stringify(tuning);
  const { data: existing } = await admin
    .from("wisdom_memories")
    .select("id")
    .eq("user_id", userId)
    .eq("memory_type", "signal_tuning")
    .maybeSingle();

  if (existing?.id) {
    await admin
      .from("wisdom_memories")
      .update({
        content: tuningContent,
        summary: `Per-kind salience floors learned from ${Object.keys(tuning).length} kinds`,
        updated_at: new Date().toISOString(),
        last_accessed_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else if (Object.keys(tuning).length > 0) {
    await admin.from("wisdom_memories").insert({
      user_id: userId,
      memory_type: "signal_tuning",
      content: tuningContent,
      summary: `Per-kind salience floors learned from ${Object.keys(tuning).length} kinds`,
      salience: 0.8,
      confidence: Math.min(1, 0.4 + Object.keys(tuning).length * 0.1),
    });
  }

  // 3. Decay pass: live signals older than 2h get salience * 0.7; expire if < 0.25.
  const decayCutoff = new Date(Date.now() - 2 * 3600_000).toISOString();
  const { data: stale } = await admin
    .from("signal_moments")
    .select("id, salience")
    .eq("user_id", userId)
    .eq("status", "live")
    .lt("created_at", decayCutoff);

  let decayed = 0;
  let expired = 0;
  for (const s of (stale ?? []) as Array<{ id: string; salience: number }>) {
    const next = s.salience * 0.7;
    if (next < 0.25) {
      await admin.from("signal_moments").update({ status: "expired" }).eq("id", s.id);
      expired++;
    } else {
      await admin.from("signal_moments").update({ salience: next }).eq("id", s.id);
      decayed++;
    }
  }

  return {
    ok: true,
    kinds_tuned: Object.keys(tuning).length,
    decayed,
    expired,
  };
}

async function tuneTick() {
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data: users } = await admin
    .from("user_context_state")
    .select("user_id")
    .gte("last_interaction_at", since)
    .order("last_interaction_at", { ascending: false })
    .limit(100);

  const list = (users ?? []) as Array<{ user_id: string }>;
  let processed = 0;
  let totalDecayed = 0;
  let totalExpired = 0;
  for (const u of list) {
    try {
      const r = await tuneUser(u.user_id);
      processed++;
      totalDecayed += r.decayed;
      totalExpired += r.expired;
    } catch (e) {
      console.warn("[signals-tune] user error", u.user_id, e instanceof Error ? e.message : e);
    }
  }
  return { processed, eligible: list.length, decayed: totalDecayed, expired: totalExpired };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") ?? "user";

    if (mode === "tick") {
      const provided = req.headers.get("x-cron-key") ?? url.searchParams.get("cron_key");
      if (provided !== CRON_KEY) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await tuneTick();
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = await resolveUser(req.headers.get("Authorization"));
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const result = await tuneUser(userId);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[signals-tune] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
