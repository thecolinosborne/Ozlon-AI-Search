// Skill Reviewer — Phase 3 of the meta-skill loop.
//
// Adapted from "One Skill to Rule Them All" by Eoghan Henn / rebelytics.com
// (https://github.com/rebelytics/one-skill-to-rule-them-all) under CC BY 4.0.
//
// Reads the user's recent skill observations (reflection_notes where
// note_type='skill_observation'), skips ones already cited by an existing
// proposed or active principle, and asks Gemini to cluster the rest into
// 0..N candidate cross-cutting principles. Each candidate is written to
// `proposed_principles` with status='pending' for the user to approve.
//
// JWT-scoped: every read/write happens as the calling user, RLS-enforced.
// Idempotent: re-running won't double-propose the same observation cluster.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const LOOKBACK_DAYS = 30;
const MAX_OBSERVATIONS = 60;
const MIN_OBSERVATIONS_TO_REVIEW = 3;

interface ProposedCandidate {
  title: string;
  principle: string;
  rationale: string;
  source_indices: number[]; // indices into the observation list we sent
  confidence: number;
}

const SYSTEM_PROMPT = `You are the Skill Reviewer for Ozlon, an AI personal OS.

You receive a numbered list of recent SKILL OBSERVATIONS captured from the user's
chats. Your job: cluster recurring or thematically related observations into
proposed CROSS-CUTTING PRINCIPLES — durable rules the AI should apply across
every skill and session.

RULES:
- Only propose a principle if at least 2 distinct observations support it, OR
  one observation is clearly high-importance (≥0.85) and generalizable.
- Skip one-offs. Skip observations that contradict each other.
- title: imperative voice, under 80 chars ("Always confirm before destructive actions").
- principle: 2-4 sentences, concrete, applicable across domains.
- rationale: 1-2 sentences explaining WHY this pattern emerged from the cited observations.
- source_indices: the 1-based indices of the observations supporting this principle.
- confidence: 0..1. 1.0 = repeated explicit user correction. 0.5 = mild signal.
- NEVER include personally identifying info, client names, secrets, or verbatim email/file content.
- Generalize the lesson into methodology only.

Respond as STRICT JSON: { "proposals": [ { title, principle, rationale, source_indices, confidence }, ... ] }
If nothing meaningful can be clustered, return { "proposals": [] }.`;

interface ObservationRow {
  id: string;
  content: string;
  importance: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

async function clusterObservations(
  observations: ObservationRow[],
): Promise<ProposedCandidate[]> {
  if (!LOVABLE_API_KEY) {
    console.warn("[skill-reviewer] LOVABLE_API_KEY missing");
    return [];
  }

  const numbered = observations
    .map((o, i) => {
      const meta = (o.metadata ?? {}) as { kind?: string; title?: string };
      const title = meta.title || (o.content.split("\n")[0] ?? "").slice(0, 100);
      return `[${i + 1}] (${meta.kind ?? "observation"}, importance=${
        (o.importance ?? 0.5).toFixed(2)
      }) ${title}\n    ${o.content.slice(0, 600)}`;
    })
    .join("\n\n");

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Observations to review (${observations.length}):\n\n${numbered}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[skill-reviewer] gateway error", res.status, errText.slice(0, 200));
    return [];
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? "{}";
  let parsed: { proposals?: ProposedCandidate[] } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const list = Array.isArray(parsed.proposals) ? parsed.proposals : [];
  return list
    .filter(
      (p) =>
        p &&
        typeof p.title === "string" &&
        typeof p.principle === "string" &&
        Array.isArray(p.source_indices) &&
        p.source_indices.length > 0,
    )
    .map((p) => ({
      title: String(p.title).slice(0, 200),
      principle: String(p.principle).slice(0, 2000),
      rationale: String(p.rationale ?? "").slice(0, 1000),
      source_indices: p.source_indices
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= observations.length),
      confidence: Math.max(0, Math.min(1, Number(p.confidence ?? 0.5))),
    }))
    .filter((p) => p.source_indices.length > 0)
    .slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return new Response(JSON.stringify({ error: "server_misconfigured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes?.user) {
    return new Response(JSON.stringify({ error: "invalid_token" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userId = userRes.user.id;

  // Find observations already cited by an existing proposal or principle.
  // We exclude those so the reviewer only clusters fresh signal.
  const sinceIso = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 3600_000,
  ).toISOString();

  const [obsRes, proposedRes, principlesRes] = await Promise.all([
    supabase
      .from("reflection_notes")
      .select("id, content, importance, metadata, created_at")
      .eq("user_id", userId)
      .eq("note_type", "skill_observation")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(MAX_OBSERVATIONS),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("proposed_principles")
      .select("source_reflection_ids")
      .eq("user_id", userId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("cross_cutting_principles")
      .select("source_reflection_ids")
      .eq("user_id", userId),
  ]);

  if (obsRes.error) {
    return new Response(
      JSON.stringify({ error: "load_failed", detail: obsRes.error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const cited = new Set<string>();
  for (const row of (proposedRes.data ?? []) as Array<{ source_reflection_ids?: string[] }>) {
    for (const id of row.source_reflection_ids ?? []) cited.add(id);
  }
  for (const row of (principlesRes.data ?? []) as Array<{ source_reflection_ids?: string[] }>) {
    for (const id of row.source_reflection_ids ?? []) cited.add(id);
  }

  const fresh: ObservationRow[] = ((obsRes.data ?? []) as ObservationRow[]).filter(
    (o) => !cited.has(o.id),
  );

  if (fresh.length < MIN_OBSERVATIONS_TO_REVIEW) {
    return new Response(
      JSON.stringify({
        ok: true,
        reviewed: fresh.length,
        proposed: 0,
        reason: "not_enough_fresh_observations",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const candidates = await clusterObservations(fresh);
  if (!candidates.length) {
    return new Response(
      JSON.stringify({ ok: true, reviewed: fresh.length, proposed: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const rows = candidates.map((c) => ({
    user_id: userId,
    title: c.title,
    principle: c.principle,
    rationale: c.rationale,
    source_reflection_ids: c.source_indices.map((idx) => fresh[idx - 1].id),
    observation_count: c.source_indices.length,
    confidence: c.confidence,
    status: "pending",
    metadata: {
      source: "skill-reviewer/v1",
      lookback_days: LOOKBACK_DAYS,
      attribution: "Methodology by Eoghan Henn / rebelytics.com (CC BY 4.0)",
    },
  }));

  const { data: inserted, error: insErr } = await supabase
    .from("proposed_principles")
    .insert(rows)
    .select("id");

  if (insErr) {
    console.error("[skill-reviewer] insert error", insErr.message);
    return new Response(
      JSON.stringify({ error: "write_failed", detail: insErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      reviewed: fresh.length,
      proposed: inserted?.length ?? 0,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
