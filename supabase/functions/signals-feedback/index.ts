// signals-feedback — write path into the Wisdom Engine.
//
// On user response (act/ignore/dismiss) we:
//   1. update signal_moments.status + outcome_note
//   2. write a reflection_notes row (note_type='signal_feedback') with embedding
//   3. detect recurrence: if ≥3 same-kind+same-outcome reflections in 14 days,
//      promote into wisdom_memories (memory_type='signal_pattern')
//   4. for meta-patterns that would change system behavior, write a
//      system_evolution_proposals row instead of mutating directly.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

async function resolveUser(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

async function embed(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY || !text) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 4000) }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.[0]?.embedding ?? null;
  } catch { return null; }
}

type Outcome = "acted" | "ignored" | "dismissed";

const VALID_OUTCOMES: Outcome[] = ["acted", "ignored", "dismissed"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const userId = await resolveUser(authHeader);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const signalId = body.signal_id as string | undefined;
    const outcome = body.outcome as Outcome | undefined;
    const note = (body.outcome_note as string | undefined)?.slice(0, 600) ?? null;

    if (!signalId || !outcome || !VALID_OUTCOMES.includes(outcome)) {
      return new Response(JSON.stringify({ error: "signal_id and outcome (acted|ignored|dismissed) required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load the signal (RLS check — must belong to caller)
    const { data: signal } = await admin.from("signal_moments")
      .select("id, user_id, kind, headline, reason, mode_context")
      .eq("id", signalId).maybeSingle();
    if (!signal || signal.user_id !== userId) {
      return new Response(JSON.stringify({ error: "signal not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Update lifecycle
    const tsField = outcome === "acted" ? "acted_at"
                  : outcome === "ignored" ? "ignored_at"
                  : "dismissed_at";
    await admin.from("signal_moments").update({
      status: outcome,
      [tsField]: new Date().toISOString(),
      outcome_note: note,
    }).eq("id", signalId);

    // 2. Write reflection_notes
    const reflectionContent = `Signal kind=${signal.kind} mode=${signal.mode_context} → ${outcome}. Headline: "${signal.headline}". ${note ? `Note: ${note}` : ""}`;
    const refEmb = await embed(reflectionContent);

    const reflectionInsert: Record<string, unknown> = {
      user_id: userId,
      note_type: "signal_feedback",
      content: reflectionContent,
      importance: outcome === "ignored" ? 0.6 : outcome === "acted" ? 0.7 : 0.4,
      source_ids: [{ type: "signal_moment", id: signalId }],
      metadata: { kind: signal.kind, outcome, mode_context: signal.mode_context },
    };
    if (refEmb) reflectionInsert.embedding = JSON.stringify(refEmb);
    await admin.from("reflection_notes").insert(reflectionInsert);

    // 3. Recurrence check — same kind + outcome, last 14 days
    const since = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
    const { data: recent } = await admin
      .from("reflection_notes")
      .select("id, metadata, created_at")
      .eq("user_id", userId)
      .eq("note_type", "signal_feedback")
      .gte("created_at", since)
      .limit(50);

    const sameKindOutcome = (recent ?? []).filter((r) => {
      const md = r.metadata as { kind?: string; outcome?: string } | null;
      return md?.kind === signal.kind && md?.outcome === outcome;
    });

    let promoted = false;
    if (sameKindOutcome.length >= 3) {
      const summary = `User typically ${outcome === "acted" ? "acts on" : outcome === "ignored" ? "ignores" : "dismisses"} signals of kind '${signal.kind}'.`;
      const memEmb = await embed(summary);

      // Upsert pattern memory by (user_id, memory_type, content) — simple existence check
      const { data: existing } = await admin
        .from("wisdom_memories")
        .select("id, recurrence_count")
        .eq("user_id", userId)
        .eq("memory_type", "signal_pattern")
        .ilike("content", `%kind '${signal.kind}'%${outcome}%`)
        .limit(1).maybeSingle();

      if (existing?.id) {
        await admin.from("wisdom_memories").update({
          recurrence_count: (existing.recurrence_count ?? 0) + 1,
          last_accessed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id);
      } else {
        const memInsert: Record<string, unknown> = {
          user_id: userId,
          memory_type: "signal_pattern",
          content: summary,
          summary,
          salience: 0.7,
          confidence: 0.7,
          recurrence_count: sameKindOutcome.length,
          metadata: { kind: signal.kind, outcome },
        };
        if (memEmb) memInsert.embedding = JSON.stringify(memEmb);
        await admin.from("wisdom_memories").insert(memInsert);
        promoted = true;
      }

      // Meta-pattern: ignored ≥5 of same kind → propose suppression
      if (outcome === "ignored" && sameKindOutcome.length >= 5) {
        await admin.from("system_evolution_proposals").insert({
          user_id: userId,
          proposal_type: "signal_throttle",
          title: `Suppress '${signal.kind}' signals`,
          description: `Last 14 days: ${sameKindOutcome.length} signals of kind '${signal.kind}' were ignored. Suggest adding a throttle so we surface these less often.`,
          status: "pending",
          metadata: { kind: signal.kind, suggested_throttle: "max 0/day" },
        });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      outcome,
      reflection_logged: true,
      pattern_promoted: promoted,
      recurrence_count: sameKindOutcome.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("[signals-feedback] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
