// signals-synthesize — produces 0–3 distilled "moments" the user may want
// to know about right now. Wisdom-fused, orchestrator-driven, mode-aware.
//
// Flow:
//   1. resolve user, load user_context_state (mode, load, quiet hours)
//   2. build context summary from recent activity
//   3. recall wisdom_memories + reflection_notes (signal_feedback) via pgvector
//   4. ask GPT (via gauntlet-router with provider=openai) to draft 0–3 moments
//   5. embed each candidate, dedup against last 48h via match_signal_moments
//   6. enforce per-kind throttles from wisdom_memories (memory_type='signal_throttle')
//   7. expire stale live signals; insert survivors

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getGoogleAccessToken } from "../_shared/google-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const CRON_KEY = Deno.env.get("SIGNALS_CRON_KEY") ?? SERVICE_ROLE;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

// ─────────── helpers ───────────
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
  } catch (e) {
    console.warn("[signals] embed failed:", e);
    return null;
  }
}

function nowIso() { return new Date().toISOString(); }

interface ContextState {
  current_mode: "focus" | "idle" | "planning" | "reactive";
  cognitive_load_estimate: number;
  quiet_hours: { start?: number; end?: number };
}

async function getContext(userId: string): Promise<ContextState> {
  const { data } = await admin
    .from("user_context_state")
    .select("current_mode, cognitive_load_estimate, quiet_hours")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    current_mode: (data?.current_mode as ContextState["current_mode"]) ?? "idle",
    cognitive_load_estimate: data?.cognitive_load_estimate ?? 0.3,
    quiet_hours: (data?.quiet_hours as ContextState["quiet_hours"]) ?? {},
  };
}

function isQuietNow(quiet: ContextState["quiet_hours"]): boolean {
  if (typeof quiet?.start !== "number" || typeof quiet?.end !== "number") return false;
  const h = new Date().getUTCHours();
  if (quiet.start <= quiet.end) return h >= quiet.start && h < quiet.end;
  return h >= quiet.start || h < quiet.end; // wraps midnight
}

// Cheap activity summary — last 24h slices used to drive the context embedding
async function buildContextSummary(userId: string): Promise<string> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [tasks, comms, events] = await Promise.all([
    admin.from("work_tasks")
      .select("title, status, next_action, last_activity_at")
      .eq("user_id", userId).is("deleted_at", null)
      .gte("last_activity_at", since).limit(20),
    admin.from("communications_messages")
      .select("from_name, subject, channel, received_at, is_unread, needs_reply")
      .eq("user_id", userId)
      .gte("received_at", since)
      .order("received_at", { ascending: false }).limit(15),
    admin.from("task_events")
      .select("event_type, detail, created_at")
      .eq("user_id", userId)
      .gte("created_at", since)
      .order("created_at", { ascending: false }).limit(15),
  ]);

  const lines: string[] = [];
  lines.push(`time_utc: ${nowIso()}`);
  if (tasks.data?.length) {
    lines.push(`OPEN_TASKS:\n` + tasks.data.map((t) =>
      `- ${t.title} [${t.status}/${t.next_action}]`).join("\n"));
  }
  if (comms.data?.length) {
    const pending = comms.data.filter((c) => c.is_unread || c.needs_reply);
    if (pending.length) {
      lines.push(`PENDING_COMMS:\n` + pending.map((c) =>
        `- ${c.channel}: ${c.from_name ?? "?"} "${(c.subject ?? "").slice(0, 60)}"`).join("\n"));
    }
  }
  if (events.data?.length) {
    lines.push(`RECENT_EVENTS:\n` + events.data.map((e) =>
      `- ${e.event_type}: ${(e.detail ?? "").slice(0, 80)}`).join("\n"));
  }
  return lines.join("\n");
}

// Wisdom recall — prior beliefs + signal feedback patterns + Phase E tuning
async function recallWisdom(userId: string, queryEmbedding: number[]) {
  const embStr = JSON.stringify(queryEmbedding);
  const [mems, refs, throttles, tuningRow] = await Promise.all([
    admin.rpc("match_wisdom_memories", {
      query_embedding: embStr, match_threshold: 0.4, match_count: 8,
      filter_user_id: userId,
    }),
    admin.rpc("match_reflections", {
      query_embedding: embStr, match_threshold: 0.4, match_count: 5,
      filter_user_id: userId, filter_note_type: "signal_feedback",
    }),
    // Per-kind throttle memories: content like "max 1 finance/day"
    admin.from("wisdom_memories")
      .select("id, content")
      .eq("user_id", userId)
      .eq("memory_type", "signal_throttle"),
    // Phase E: outcome-driven per-kind tuning written by signals-tune.
    admin.from("wisdom_memories")
      .select("content")
      .eq("user_id", userId)
      .eq("memory_type", "signal_tuning")
      .maybeSingle(),
  ]);

  let tuning: Record<string, { floor: number; sample_size: number }> = {};
  if (tuningRow.data?.content) {
    try { tuning = JSON.parse(tuningRow.data.content); } catch { tuning = {}; }
  }

  return {
    memories: (mems.data ?? []) as Array<{ id: string; content: string; summary: string | null }>,
    reflections: (refs.data ?? []) as Array<{ id: string; content: string }>,
    throttles: (throttles.data ?? []) as Array<{ id: string; content: string }>,
    tuning,
  };
}

// ─────────── orchestrator call (gauntlet-router → openai) ───────────
interface Candidate {
  kind: string;
  headline: string;
  reason: string;
  suggested_direction?: string;
  salience: number;
  confidence: number;
  mode_context?: string;
  source_refs?: Array<{ type: string; id: string }>;
  wisdom_memory_ids?: string[];
}

async function synthesize(
  userId: string,
  ctx: ContextState,
  contextSummary: string,
  recall: Awaited<ReturnType<typeof recallWisdom>>,
): Promise<Candidate[]> {
  const wisdomBlock = recall.memories.length
    ? recall.memories.map((m) => `[${m.id}] ${m.summary ?? m.content.slice(0, 200)}`).join("\n")
    : "(no prior beliefs)";
  const reflectionBlock = recall.reflections.length
    ? recall.reflections.map((r) => `- ${r.content.slice(0, 200)}`).join("\n")
    : "(no prior signal feedback)";
  const throttleBlock = recall.throttles.length
    ? recall.throttles.map((t) => `- ${t.content}`).join("\n")
    : "(no throttles)";
  const tuningEntries = Object.entries(recall.tuning ?? {});
  const tuningBlock = tuningEntries.length
    ? tuningEntries.map(([kind, t]) =>
        `- ${kind}: floor=${t.floor.toFixed(2)} (n=${t.sample_size})`).join("\n")
    : "(no tuning yet)";

  const system = `You are the Signals layer of an AI personal operating system.
Your job is to surface AT MOST 3 moments — often 0 or 1 — that materially shift the user's direction right now.

CURRENT MODE: ${ctx.current_mode}
COGNITIVE_LOAD: ${ctx.cognitive_load_estimate}

Mode rules:
- focus: return [] unless salience >= 0.9
- idle: at most 1 reflective moment is OK
- planning: up to 3 moments allowed, opportunities welcome
- reactive: short directive headlines only, max 2

PRIOR BELIEFS ABOUT THIS USER (from wisdom memories — use these to make signals feel known, not generic):
${wisdomBlock}

PAST SIGNAL FEEDBACK (what they ignored / acted on — respect this strongly):
${reflectionBlock}

THROTTLES (suppress if you'd exceed):
${throttleBlock}

LEARNED SALIENCE FLOORS PER KIND (from outcomes — only emit a moment of that kind if its salience clears the floor):
${tuningBlock}

For each moment include: kind (free text like commitment_due, inbox_pressure, pattern_break, opportunity, risk, reflection), headline, reason, suggested_direction (optional), salience (0–1, how much this matters NOW), confidence (0–1, how sure you are), mode_context (focus|idle|planning|reactive|any), source_refs (array of {type, id} from the context — types include work_task, comm_message, task_event), wisdom_memory_ids (array of memory UUIDs you used).

Voice rules (calm Jarvis tone — strict):
- Each headline ≤ 14 words. No emoji. No exclamation.
- Reason ≤ 2 calm sentences. May reference trajectory ("connects to something coming up later").
- suggested_direction is ONE neutral option, not a command. Optional.
- If nothing materially matters, return an empty array. Silence is the correct answer most of the time.`;

  const user = `CURRENT CONTEXT (last 24h):
${contextSummary}

Return your moments via the emit_moments tool.`;

  // Call gauntlet-router with explicit OpenAI routing
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/gauntlet-router`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({
      action: "call",
      node_type: "signals-synthesize",
      needs: { modality: "text", complexity: "high", latency_priority: "relaxed", cost_sensitivity: "low" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [{
        type: "function",
        function: {
          name: "emit_moments",
          description: "Return 0–3 distilled signal moments for the user.",
          parameters: {
            type: "object",
            properties: {
              moments: {
                type: "array",
                maxItems: 3,
                items: {
                  type: "object",
                  properties: {
                    kind: { type: "string" },
                    headline: { type: "string" },
                    reason: { type: "string" },
                    suggested_direction: { type: "string" },
                    salience: { type: "number" },
                    confidence: { type: "number" },
                    mode_context: { type: "string" },
                    source_refs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          type: { type: "string" },
                          id: { type: "string" },
                        },
                        required: ["type", "id"],
                      },
                    },
                    wisdom_memory_ids: { type: "array", items: { type: "string" } },
                  },
                  required: ["kind", "headline", "reason", "salience", "confidence"],
                },
              },
            },
            required: ["moments"],
          },
        },
      }],
    }),
  });

  if (!resp.ok) {
    console.error("[signals] gauntlet-router failed", resp.status, await resp.text().catch(() => ""));
    return [];
  }
  const data = await resp.json();
  const result = data?.result;
  const choice = result?.choices?.[0];
  const toolCall = choice?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) return [];
  try {
    const parsed = JSON.parse(toolCall.function.arguments);
    return Array.isArray(parsed?.moments) ? parsed.moments : [];
  } catch {
    return [];
  }
}

// ─────────── dedup + insert ───────────
async function insertWithDedup(
  userId: string,
  ctx: ContextState,
  moments: Candidate[],
  tuning: Record<string, { floor: number; sample_size: number }> = {},
) {
  const inserted: string[] = [];

  for (const m of moments) {
    if (typeof m.headline !== "string" || !m.headline.trim()) continue;

    // Phase E — enforce learned per-kind salience floor (hard cutoff).
    const kindFloor = tuning[m.kind]?.floor;
    if (typeof kindFloor === "number" && (Number(m.salience) || 0) < kindFloor) {
      console.log(`[signals] dropped kind=${m.kind} salience=${m.salience} below learned floor=${kindFloor}`);
      continue;
    }

    const emb = await embed(`${m.headline}\n${m.reason ?? ""}`);
    let isDup = false;
    if (emb) {
      const { data: matches } = await admin.rpc("match_signal_moments", {
        query_embedding: JSON.stringify(emb),
        match_threshold: 0.88,
        match_count: 3,
        filter_user_id: userId,
        hours_back: 48,
      });
      if (Array.isArray(matches) && matches.length > 0) {
        // Supersede lower-salience matches; skip if any live with >= salience exists
        for (const mm of matches as Array<{ id: string; salience: number; status: string }>) {
          if (mm.status === "live" && mm.salience >= m.salience) {
            isDup = true; break;
          }
          if (mm.status === "live" && mm.salience < m.salience) {
            await admin.from("signal_moments")
              .update({ status: "superseded" }).eq("id", mm.id);
          }
        }
      }
    }
    if (isDup) continue;

    const salience = Math.max(0, Math.min(1, Number(m.salience) || 0.5));
    const confidence = Math.max(0, Math.min(1, Number(m.confidence) || 0.5));
    const modeRaw = m.mode_context ?? "any";
    const mode = ["focus", "idle", "planning", "reactive", "any"].includes(modeRaw) ? modeRaw : "any";

    const { data: row, error } = await admin.from("signal_moments").insert({
      user_id: userId,
      kind: (m.kind || "general").slice(0, 50),
      headline: m.headline.slice(0, 240),
      reason: (m.reason ?? "").slice(0, 600) || null,
      suggested_direction: m.suggested_direction?.slice(0, 600) ?? null,
      salience,
      confidence,
      mode_context: mode,
      source_refs: m.source_refs ?? [],
      wisdom_memory_ids: m.wisdom_memory_ids ?? [],
      embedding: emb ? JSON.stringify(emb) : null,
      status: "live",
    }).select("id").single();

    if (error) {
      console.warn("[signals] insert failed:", error.message);
      continue;
    }
    if (row?.id) inserted.push(row.id);
  }

  // Expire stale live signals (past expires_at)
  await admin.from("signal_moments")
    .update({ status: "expired" })
    .eq("user_id", userId)
    .eq("status", "live")
    .lt("expires_at", nowIso());

  return inserted;
}

// ─────────── Phase B: anticipation / lookahead ───────────

// Pull calendar events 24h–7d out + open commitments due in same window.
async function buildLookaheadSummary(userId: string): Promise<string> {
  const now = new Date();
  const startIso = new Date(now.getTime() + 24 * 3600_000).toISOString();
  const endIso = new Date(now.getTime() + 7 * 24 * 3600_000).toISOString();

  const lines: string[] = [];
  lines.push(`time_utc: ${nowIso()}`);
  lines.push(`lookahead_window: ${startIso} → ${endIso}`);

  // Calendar events (best-effort — silent skip if calendar not connected)
  try {
    const token = await getGoogleAccessToken(userId);
    if (token) {
      const qs = new URLSearchParams({
        timeMin: startIso, timeMax: endIso,
        singleEvents: "true", orderBy: "startTime", maxResults: "30",
      });
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${qs.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const data = await res.json();
        const items = (data?.items ?? []) as Array<Record<string, unknown>>;
        if (items.length) {
          lines.push(`UPCOMING_EVENTS:\n` + items.slice(0, 25).map((e) => {
            const start = (e.start as { dateTime?: string; date?: string } | undefined)?.dateTime
              ?? (e.start as { date?: string } | undefined)?.date ?? "?";
            const summary = (e.summary as string | undefined) ?? "(untitled)";
            const attendeeCount = Array.isArray(e.attendees) ? (e.attendees as unknown[]).length : 0;
            return `- ${start} | ${summary}${attendeeCount ? ` | ${attendeeCount} attendees` : ""}`;
          }).join("\n"));
        }
      }
    }
  } catch (e) {
    console.log("[signals-lookahead] calendar skip:", e instanceof Error ? e.message : e);
  }

  // Tasks/commitments coming due in window
  const { data: dueTasks } = await admin.from("work_tasks")
    .select("title, status, next_action, due_at")
    .eq("user_id", userId).is("deleted_at", null)
    .neq("status", "completed")
    .gte("due_at", now.toISOString())
    .lte("due_at", endIso)
    .order("due_at", { ascending: true })
    .limit(20);
  if (dueTasks?.length) {
    lines.push(`COMMITMENTS_DUE_SOON:\n` + dueTasks.map((t) =>
      `- ${t.due_at}: ${t.title} [${t.status}/${t.next_action ?? "?"}]`).join("\n"));
  }

  // Recent activity, for trajectory continuity
  const recentSummary = await buildContextSummary(userId);
  lines.push(`RECENT_ACTIVITY (last 24h):\n${recentSummary}`);

  return lines.join("\n\n");
}

async function synthesizeLookahead(
  userId: string,
  ctx: ContextState,
  summary: string,
  recall: Awaited<ReturnType<typeof recallWisdom>>,
): Promise<Candidate[]> {
  const wisdomBlock = recall.memories.length
    ? recall.memories.map((m) => `[${m.id}] ${m.summary ?? m.content.slice(0, 200)}`).join("\n")
    : "(no prior beliefs)";
  const reflectionBlock = recall.reflections.length
    ? recall.reflections.map((r) => `- ${r.content.slice(0, 200)}`).join("\n")
    : "(no prior signal feedback)";
  const throttleBlock = recall.throttles.length
    ? recall.throttles.map((t) => `- ${t.content}`).join("\n")
    : "(no throttles)";
  const tuningEntries = Object.entries(recall.tuning ?? {});
  const tuningBlock = tuningEntries.length
    ? tuningEntries.map(([kind, t]) =>
        `- ${kind}: floor=${t.floor.toFixed(2)} (n=${t.sample_size})`).join("\n")
    : "(no tuning yet)";

  const system = `You are the Signals layer running an ANTICIPATION pass.
Look 24 hours to 7 days ahead. Your job is to surface AT MOST 2 moments — usually 0 or 1 — of kind "risk" or "opportunity" that the user should know about NOW so future-them is aligned.

Bias hard toward silence. Only emit a moment if:
- a commitment is drifting (no recent activity, due within 72h) → kind=risk
- an upcoming meeting needs prep that hasn't happened → kind=risk
- a pattern in past behavior plus an upcoming event creates a leverage window → kind=opportunity

PRIOR BELIEFS:
${wisdomBlock}

PAST SIGNAL FEEDBACK (respect strongly):
${reflectionBlock}

THROTTLES:
${throttleBlock}

LEARNED SALIENCE FLOORS PER KIND (only emit if salience clears the floor):
${tuningBlock}

Voice rules (calm Jarvis, strict):
- Headline ≤ 14 words. No emoji. No exclamation.
- Reason ≤ 2 sentences. May reference the future event explicitly ("ahead of Thursday's call").
- suggested_direction is ONE neutral option. Optional.
- mode_context for anticipation moments should be "any" or "planning".
- Salience 0.6–0.9 typical; reserve 0.9+ for true blockers.
- If nothing materially needs attention, return [].`;

  const user = `LOOKAHEAD CONTEXT:
${summary}

Return your moments via the emit_moments tool.`;

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/gauntlet-router`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({
      action: "call",
      node_type: "signals-lookahead",
      needs: { modality: "text", complexity: "high", latency_priority: "relaxed", cost_sensitivity: "low" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [{
        type: "function",
        function: {
          name: "emit_moments",
          description: "Return 0–2 anticipation moments (risk or opportunity).",
          parameters: {
            type: "object",
            properties: {
              moments: {
                type: "array", maxItems: 2,
                items: {
                  type: "object",
                  properties: {
                    kind: { type: "string", enum: ["risk", "opportunity"] },
                    headline: { type: "string" },
                    reason: { type: "string" },
                    suggested_direction: { type: "string" },
                    salience: { type: "number" },
                    confidence: { type: "number" },
                    mode_context: { type: "string" },
                    source_refs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: { type: { type: "string" }, id: { type: "string" } },
                        required: ["type", "id"],
                      },
                    },
                    wisdom_memory_ids: { type: "array", items: { type: "string" } },
                  },
                  required: ["kind", "headline", "reason", "salience", "confidence"],
                },
              },
            },
            required: ["moments"],
          },
        },
      }],
    }),
  });

  if (!resp.ok) {
    console.error("[signals-lookahead] router failed", resp.status, await resp.text().catch(() => ""));
    return [];
  }
  const data = await resp.json();
  const toolCall = data?.result?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) return [];
  try {
    const parsed = JSON.parse(toolCall.function.arguments);
    return Array.isArray(parsed?.moments) ? parsed.moments : [];
  } catch {
    return [];
  }
}

async function runLookaheadForUser(userId: string) {
  const ctx = await getContext(userId);
  if (isQuietNow(ctx.quiet_hours)) return { skipped: "quiet_hours" };
  if (ctx.current_mode === "focus") return { skipped: "focus_mode" };

  const summary = await buildLookaheadSummary(userId);
  const ctxEmb = await embed(summary);
  const recall = ctxEmb
    ? await recallWisdom(userId, ctxEmb)
    : { memories: [], reflections: [], throttles: [] };

  const candidates = await synthesizeLookahead(userId, ctx, summary, recall);
  const inserted = await insertWithDedup(userId, ctx, candidates);
  return { ok: true, candidate_count: candidates.length, inserted_count: inserted.length };
}

// Cron tick: iterate users active in last 7d. Cap to keep it bounded.
async function lookaheadTick() {
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data: users } = await admin
    .from("user_context_state")
    .select("user_id, last_interaction_at")
    .gte("last_interaction_at", since)
    .order("last_interaction_at", { ascending: false })
    .limit(50);

  const list = (users ?? []) as Array<{ user_id: string }>;
  let processed = 0;
  let inserted = 0;
  for (const u of list) {
    try {
      const r = await runLookaheadForUser(u.user_id);
      processed++;
      if ("inserted_count" in r) inserted += r.inserted_count ?? 0;
    } catch (e) {
      console.warn("[signals-lookahead] user error", u.user_id, e instanceof Error ? e.message : e);
    }
  }
  return { processed, inserted, eligible: list.length };
}

// ─────────── handler ───────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") ?? "now";

    // Cron path: scheduled-routines invokes with ?mode=lookahead_tick
    if (mode === "lookahead_tick") {
      const provided = req.headers.get("x-cron-key") ?? url.searchParams.get("cron_key");
      if (provided !== CRON_KEY) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await lookaheadTick();
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    const userId = await resolveUser(authHeader);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Per-user lookahead (callable from UI for "look ahead now")
    if (mode === "lookahead") {
      const result = await runLookaheadForUser(userId);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Default: real-time synthesis
    const recentCutoff = new Date(Date.now() - 60_000).toISOString();
    const { count } = await admin.from("signal_moments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", recentCutoff);
    if ((count ?? 0) > 0) {
      return new Response(JSON.stringify({ skipped: "throttled", reason: "recent_synth" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ctx = await getContext(userId);
    if (isQuietNow(ctx.quiet_hours)) {
      return new Response(JSON.stringify({ skipped: "quiet_hours" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contextSummary = await buildContextSummary(userId);
    const ctxEmb = await embed(contextSummary);
    const recall = ctxEmb
      ? await recallWisdom(userId, ctxEmb)
      : { memories: [], reflections: [], throttles: [] };

    const candidates = await synthesize(userId, ctx, contextSummary, recall);
    const inserted = await insertWithDedup(userId, ctx, candidates);

    return new Response(JSON.stringify({
      ok: true,
      mode: ctx.current_mode,
      candidate_count: candidates.length,
      inserted_count: inserted.length,
      inserted_ids: inserted,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("[signals-synthesize] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
