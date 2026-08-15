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
import { renderForChatPrompt } from "../_shared/signals/render.ts";
import type { SignalEnvelope } from "../_shared/signals/types.ts";

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
  // Header-injection pattern (matches signals-brief / research; reliable with
  // Supabase signing-keys JWTs where explicit-token getUser can 403 with
  // "missing sub claim").
  try {
    const sb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data, error } = await sb.auth.getUser();
    if (!error && data?.user?.id) return data.user.id;
  } catch (_) { /* ignore */ }
  // Last-resort fallback for older sessions
  try {
    const token = authHeader.slice(7);
    const sb = createClient(SUPABASE_URL, ANON_KEY);
    const { data } = await sb.auth.getUser(token);
    if (data.user?.id) return data.user.id;
  } catch (_) { /* ignore */ }
  // Final fallback: validate the token with the service-role client. This works
  // with signing-keys JWTs where the anon-key paths can fail.
  try {
    const token = authHeader.slice(7);
    const { data } = await admin.auth.getUser(token);
    if (data.user?.id) return data.user.id;
  } catch (_) { /* ignore */ }
  return null;
}

// Retry transient upstream failures (cold-start 503s, 429/502/504, network errors).
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  { tries = 3, baseDelayMs = 500 }: { tries?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const resp = await fetch(url, init);
      if (resp.ok) return resp;
      if (![429, 502, 503, 504].includes(resp.status) || attempt === tries - 1) {
        return resp;
      }
      // drain body so connection can be reused
      await resp.text().catch(() => "");
    } catch (e) {
      lastErr = e;
      if (attempt === tries - 1) throw e;
    }
    const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 250;
    await new Promise((r) => setTimeout(r, delay));
  }
  throw lastErr ?? new Error("fetchWithRetry exhausted");
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
  envelope: SignalEnvelope | null = null,
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
- If nothing materially matters, return an empty array. Silence is the correct answer most of the time.${
  envelope ? `\n\n${renderForChatPrompt(envelope, { topN: 3 })}\n\nWhen any moment touches an account/entity in the priority context above, prefer it and reference it by name in the headline.` : ""
}`;

  const user = `CURRENT CONTEXT (last 24h):
${contextSummary}

Return your moments via the emit_moments tool.`;

  // Call gauntlet-router with explicit OpenAI routing
  const resp = await fetchWithRetry(`${SUPABASE_URL}/functions/v1/gauntlet-router`, {
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
        match_threshold: 0.82,
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

  const resp = await fetchWithRetry(`${SUPABASE_URL}/functions/v1/gauntlet-router`, {
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

// ─────────── Daily Digest: wide cross-integration scan ───────────

async function callIntegration(
  fnName: string,
  body: Record<string, unknown>,
  authHeader: string,
): Promise<unknown> {
  try {
    const res = await fetchWithRetry(
      `${SUPABASE_URL}/functions/v1/${fnName}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          apikey: ANON_KEY,
        },
        body: JSON.stringify(body),
      },
      { tries: 2, baseDelayMs: 400 },
    );
    if (!res.ok) {
      await res.text().catch(() => "");
      return null;
    }
    return await res.json().catch(() => null);
  } catch (e) {
    console.log(`[digest] ${fnName} skipped:`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function buildDigestSummary(userId: string, authHeader: string): Promise<{ summary: string; sourcesIncluded: string[] }> {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const sources: string[] = [];
  const lines: string[] = [];
  lines.push(`time_utc: ${nowIso()}`);

  // Calendar — today + next 24h (use existing helper)
  try {
    const token = await getGoogleAccessToken(userId);
    if (token) {
      const qs = new URLSearchParams({
        timeMin: now.toISOString(),
        timeMax: new Date(now.getTime() + 24 * 3600_000).toISOString(),
        singleEvents: "true", orderBy: "startTime", maxResults: "20",
      });
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?${qs.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const data = await res.json();
        const items = (data?.items ?? []) as Array<Record<string, unknown>>;
        if (items.length) {
          sources.push("calendar");
          lines.push(`CALENDAR_NEXT_24H:\n` + items.slice(0, 15).map((e) => {
            const start = (e.start as { dateTime?: string; date?: string })?.dateTime
              ?? (e.start as { date?: string })?.date ?? "?";
            const summary = (e.summary as string) ?? "(untitled)";
            const att = Array.isArray(e.attendees) ? (e.attendees as unknown[]).length : 0;
            return `- ${start} | ${summary}${att ? ` | ${att} attendees` : ""}`;
          }).join("\n"));
        }
      }
    }
  } catch (e) {
    console.log("[digest] calendar skip:", e instanceof Error ? e.message : e);
  }

  // Communications digest (already aggregates Gmail/Slack/GHL counts + priorities)
  const commsRaw = await callIntegration("communications-digest", {}, authHeader);
  const commsData = (commsRaw && typeof commsRaw === "object")
    ? ((commsRaw as Record<string, unknown>).data ?? commsRaw) as Record<string, unknown>
    : null;
  if (commsData) {
    sources.push("communications");
    const hero = commsData.heroLine as string | undefined;
    const sub = commsData.subLine as string | undefined;
    const prios = (commsData.priorities ?? []) as Array<{ who?: string; channelLabel?: string; what?: string }>;
    const block: string[] = [`COMMUNICATIONS_DIGEST:`];
    if (hero) block.push(`- hero: ${hero}`);
    if (sub) block.push(`- sub: ${sub}`);
    if (prios.length) {
      block.push(`- priorities:`);
      prios.slice(0, 5).forEach((p, i) =>
        block.push(`  ${i + 1}. ${p.who ?? "?"} (${p.channelLabel ?? "?"}): ${p.what ?? ""}`));
    }
    lines.push(block.join("\n"));
  }

  // Open tasks due today / overdue (from work_tasks — local source, always available)
  const todayEnd = new Date(now); todayEnd.setUTCHours(23, 59, 59, 999);
  const { data: dueToday } = await admin.from("work_tasks")
    .select("title, status, next_action, due_at")
    .eq("user_id", userId).is("deleted_at", null)
    .neq("status", "completed")
    .lte("due_at", todayEnd.toISOString())
    .order("due_at", { ascending: true })
    .limit(15);
  if (dueToday?.length) {
    sources.push("tasks");
    lines.push(`TASKS_DUE_TODAY_OR_OVERDUE:\n` + dueToday.map((t) =>
      `- ${t.due_at}: ${t.title} [${t.status}/${t.next_action ?? "?"}]`).join("\n"));
  }

  // Recent activity context (reuse 24h summary builder)
  const recent = await buildContextSummary(userId);
  if (recent) {
    sources.push("activity");
    lines.push(`RECENT_ACTIVITY:\n${recent}`);
  }

  void since24h;
  return { summary: lines.join("\n\n"), sourcesIncluded: sources };
}

async function synthesizeDigest(
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

  const system = `You are the Signals layer running a DAILY DIGEST pass.
You have a wide cross-integration snapshot of the user's day: calendar, communications, tasks, recent activity. Produce AT MOST 5 distilled moments — a calm chief-of-staff brief.

Each moment MUST use kind="digest". Cover the day's shape: meetings ahead, awaiting replies, things due, money/SEO/data deltas worth knowing, opportunities. Skip integrations that returned nothing — do not narrate absence.

PRIOR BELIEFS:
${wisdomBlock}

PAST FEEDBACK (respect strongly):
${reflectionBlock}

Voice rules (calm Jarvis tone, strict):
- Headline ≤ 14 words. No emoji. No exclamation.
- Reason ≤ 2 calm sentences.
- suggested_direction is ONE neutral option. Optional.
- mode_context = "any" or "planning".
- Salience 0.5–0.9 typical.
- If genuinely nothing matters, return [].`;

  const user = `DIGEST CONTEXT:
${summary}

Return your moments via the emit_moments tool. Every moment must have kind="digest".`;

  const resp = await fetchWithRetry(`${SUPABASE_URL}/functions/v1/gauntlet-router`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({
      action: "call",
      node_type: "signals-daily-digest",
      needs: { modality: "text", complexity: "high", latency_priority: "relaxed", cost_sensitivity: "low" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [{
        type: "function",
        function: {
          name: "emit_moments",
          description: "Return 0–5 daily digest moments (kind='digest').",
          parameters: {
            type: "object",
            properties: {
              moments: {
                type: "array", maxItems: 5,
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
    console.error("[digest] router failed", resp.status, await resp.text().catch(() => ""));
    return [];
  }
  const data = await resp.json();
  const toolCall = data?.result?.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) return [];
  try {
    const parsed = JSON.parse(toolCall.function.arguments);
    const arr = Array.isArray(parsed?.moments) ? parsed.moments as Candidate[] : [];
    // Force kind=digest so UI filtering is reliable.
    return arr.map((m) => ({ ...m, kind: "digest" }));
  } catch {
    return [];
  }
}

async function runDigestForUser(userId: string, authHeader: string) {
  // 6h throttle: check newest digest moment.
  const sixHoursAgo = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data: recentDigest } = await admin
    .from("signal_moments")
    .select("id, created_at")
    .eq("user_id", userId)
    .eq("kind", "digest")
    .gte("created_at", sixHoursAgo)
    .order("created_at", { ascending: false })
    .limit(1);
  if (recentDigest && recentDigest.length > 0) {
    return { skipped: "throttled_6h", last_at: recentDigest[0].created_at };
  }

  const ctx = await getContext(userId);
  const { summary, sourcesIncluded } = await buildDigestSummary(userId, authHeader);
  const ctxEmb = await embed(summary);
  const recall = ctxEmb
    ? await recallWisdom(userId, ctxEmb)
    : { memories: [], reflections: [], throttles: [], tuning: {} };

  const candidates = await synthesizeDigest(userId, ctx, summary, recall);
  const inserted = await insertWithDedup(userId, ctx, candidates, recall.tuning);
  return {
    ok: true,
    sources_included: sourcesIncluded,
    candidate_count: candidates.length,
    inserted_count: inserted.length,
    inserted_ids: inserted,
  };
}

async function digestTick() {
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data: users } = await admin
    .from("user_context_state")
    .select("user_id, last_interaction_at")
    .gte("last_interaction_at", since)
    .order("last_interaction_at", { ascending: false })
    .limit(100);

  const list = (users ?? []) as Array<{ user_id: string }>;
  let processed = 0;
  let inserted = 0;
  // Service-role auth for cron fan-out — integration fns will fall back to
  // per-user resolution via user_id-bound credentials.
  const cronAuth = `Bearer ${SERVICE_ROLE}`;
  for (const u of list) {
    try {
      const r = await runDigestForUser(u.user_id, cronAuth);
      processed++;
      if ("inserted_count" in r) inserted += (r.inserted_count as number) ?? 0;
    } catch (e) {
      console.warn("[digest-tick] user error", u.user_id, e instanceof Error ? e.message : e);
    }
  }
  return { processed, inserted, eligible: list.length };
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
  const inserted = await insertWithDedup(userId, ctx, candidates, recall.tuning);
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
    if (mode === "lookahead_tick" || mode === "daily_digest_tick") {
      const provided = req.headers.get("x-cron-key") ?? url.searchParams.get("cron_key");
      if (provided !== CRON_KEY) {
        return new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = mode === "lookahead_tick" ? await lookaheadTick() : await digestTick();
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    const userId = await resolveUser(authHeader);
    if (!userId) {
      console.warn("[signals-synthesize] auth failed; header present:", !!authHeader);
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

    // Per-user daily digest (callable from UI "Scan now")
    if (mode === "daily_digest") {
      const result = await runDigestForUser(userId, authHeader!);
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

    // Optional envelope from caller (chat passes its built envelope to align
    // synthesis with the user's current intent / in-scope account).
    let envelope: SignalEnvelope | null = null;
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        if (body && typeof body === "object" && body.envelope) {
          envelope = body.envelope as SignalEnvelope;
        }
      }
    } catch (_e) { /* non-fatal */ }

    const contextSummary = await buildContextSummary(userId);
    const ctxEmb = await embed(contextSummary);
    const recall = ctxEmb
      ? await recallWisdom(userId, ctxEmb)
      : { memories: [], reflections: [], throttles: [] };

    const candidates = await synthesize(userId, ctx, contextSummary, recall, envelope);
    const inserted = await insertWithDedup(userId, ctx, candidates, recall.tuning);

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
