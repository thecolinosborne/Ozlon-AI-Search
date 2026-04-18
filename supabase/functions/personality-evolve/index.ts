// Personality Evolution — Phase 2
// Periodically scans recent chat history per user, extracts atomic personality
// refinement proposals, and queues them in `system_evolution_proposals` for the
// user to approve/reject in /settings/personality.
//
// Triggered by:
//   - Cron (hourly): scans all users with recent activity (idle path)
//   - Direct invoke with { user_id } body: forced extraction (turn path / debug)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

// Trigger thresholds
const TURN_THRESHOLD = 20;        // every 20 user turns since last extraction
const IDLE_MINUTES = 5;           // OR 5 min since last message
const LOOKBACK_MESSAGES = 60;     // chat window we feed to extractor
const MIN_NEW_USER_MSGS = 5;      // skip if fewer than 5 new user msgs
const MAX_PENDING_PER_USER = 25;  // hard cap to avoid runaway

// ----- Types --------------------------------------------------------------

interface PersonalityRow {
  identity: { statement?: string };
  about_me: string | null;
  house_rules: string[];
  tone_settings: Record<string, number>;
  reference_persona: string | null;
}

type ProposalField = "identity" | "about_me" | "house_rules" | "tone_settings";

interface AtomicProposal {
  field: ProposalField;
  title: string;          // short summary (≤60 chars)
  description: string;    // why — what user said/showed
  current_value: string;  // before (for diff)
  proposed_value: string; // after (for diff)
  // For tone_settings, proposed_value is JSON: {"warmth": 70} (single key)
  // For house_rules, proposed_value is the new rule string (added to array)
  // For about_me, proposed_value is the new full text (or addition marker)
  // For identity, proposed_value is the new statement
  evidence: string;       // 1-line quote/observation justifying it
}

// ----- Helpers ------------------------------------------------------------

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function loadPersonality(userId: string): Promise<PersonalityRow> {
  const { data } = await sb
    .from("user_personality")
    .select("identity, about_me, house_rules, tone_settings, reference_persona")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    identity: (data?.identity as { statement?: string }) || {},
    about_me: data?.about_me ?? null,
    house_rules: (data?.house_rules as string[]) || [],
    tone_settings: (data?.tone_settings as Record<string, number>) || {},
    reference_persona: data?.reference_persona ?? null,
  };
}

async function loadRecentMessages(userId: string): Promise<
  { role: string; content: string; created_at: string }[]
> {
  const { data } = await sb
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(LOOKBACK_MESSAGES);
  return (data || []).reverse();
}

async function getLastExtractionAt(userId: string): Promise<Date | null> {
  const { data } = await sb
    .from("system_evolution_proposals")
    .select("created_at, metadata")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const meta = (data.metadata as Record<string, unknown>) || {};
  const ts = (meta.last_scan_at as string) || (data.created_at as string);
  return ts ? new Date(ts) : null;
}

async function countPendingProposals(userId: string): Promise<number> {
  const { count } = await sb
    .from("system_evolution_proposals")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending");
  return count || 0;
}

// Decide whether this user is due for extraction.
async function shouldExtract(
  userId: string,
  msgs: { role: string; created_at: string }[],
): Promise<{ go: boolean; reason: string }> {
  if (msgs.length === 0) return { go: false, reason: "no_messages" };

  const pending = await countPendingProposals(userId);
  if (pending >= MAX_PENDING_PER_USER) return { go: false, reason: "queue_full" };

  const lastExtraction = await getLastExtractionAt(userId);
  const newMsgs = lastExtraction
    ? msgs.filter((m) => new Date(m.created_at) > lastExtraction)
    : msgs;

  const newUserMsgs = newMsgs.filter((m) => m.role === "user").length;
  if (newUserMsgs < MIN_NEW_USER_MSGS) {
    return { go: false, reason: `too_few_new_msgs(${newUserMsgs})` };
  }

  // Idle path: last message older than IDLE_MINUTES
  const lastMsg = msgs[msgs.length - 1];
  const ageMin = (Date.now() - new Date(lastMsg.created_at).getTime()) / 60000;
  const isIdle = ageMin >= IDLE_MINUTES;

  // Turn path: ≥ TURN_THRESHOLD new user msgs since last extraction
  const turnHit = newUserMsgs >= TURN_THRESHOLD;

  if (isIdle || turnHit) {
    return { go: true, reason: turnHit ? `turns(${newUserMsgs})` : `idle(${Math.round(ageMin)}m)` };
  }
  return { go: false, reason: `waiting(${newUserMsgs}msgs,${Math.round(ageMin)}m)` };
}

// ----- Extraction ---------------------------------------------------------

const EXTRACTOR_SYSTEM = `You are a personality refinement extractor for a personal AI OS.

Your job: scan recent conversation between a user and their AI, then propose ATOMIC refinements to the user's personality profile that would make the AI better aligned to them.

You output a JSON array of proposals. Each proposal touches EXACTLY ONE FIELD and represents ONE small change. Be conservative — propose nothing if there's no clear signal. 0-5 proposals per run is normal. Never propose duplicates of what's already in the profile.

The four fields:
  - "identity": the AI's core identity statement (rarely change — only if user explicitly redefines who the AI is)
  - "about_me": long-form context about the user (add new biographical/contextual facts they revealed)
  - "house_rules": explicit do's and don'ts the user stated ("always X", "never Y", "stop doing Z")
  - "tone_settings": four sliders 0-100: formality, verbosity, challenge, warmth (only adjust if user gave clear feedback like "be shorter" → lower verbosity)

Rules:
  - Each proposal must be grounded in specific user statements (quote in "evidence")
  - "title" ≤ 60 chars, action-oriented ("Add house rule: never ask permission")
  - "current_value" = exact current state of that field (string)
  - "proposed_value":
      • identity → new statement string
      • about_me → new FULL about_me text (current + addition merged naturally)
      • house_rules → just the new rule string (will be appended)
      • tone_settings → JSON object with ONE key {"warmth": 70}
  - Skip if user only complained once — wait for repeated signal
  - Skip pure task chatter ("what's the weather", "send email")

Output strictly: {"proposals": [...]}  (empty array if nothing worth proposing)`;

interface ExtractorOutput { proposals: AtomicProposal[]; }

async function extractProposals(
  personality: PersonalityRow,
  msgs: { role: string; content: string }[],
): Promise<AtomicProposal[]> {
  const profileSnapshot = JSON.stringify(
    {
      identity: personality.identity?.statement || "(unset)",
      about_me: personality.about_me || "(unset)",
      house_rules: personality.house_rules,
      tone_settings: personality.tone_settings,
    },
    null,
    2,
  );

  const transcript = msgs
    .map((m) => `[${m.role}] ${m.content.slice(0, 800)}`)
    .join("\n");

  const userPrompt = `CURRENT PROFILE:\n${profileSnapshot}\n\nRECENT CONVERSATION:\n${transcript}\n\nReturn JSON: {"proposals":[...]}`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: EXTRACTOR_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.error("[evolve] LLM call failed", resp.status, txt);
    return [];
  }
  const json = await resp.json();
  const content = json?.choices?.[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(content) as ExtractorOutput;
    return Array.isArray(parsed.proposals) ? parsed.proposals : [];
  } catch (e) {
    console.error("[evolve] JSON parse failed", e, content.slice(0, 200));
    return [];
  }
}

// Filter out near-duplicate proposals already pending for this user
async function dedupe(
  userId: string,
  proposals: AtomicProposal[],
): Promise<AtomicProposal[]> {
  if (proposals.length === 0) return [];
  const { data } = await sb
    .from("system_evolution_proposals")
    .select("title, metadata")
    .eq("user_id", userId)
    .eq("status", "pending");
  const existing = new Set(
    (data || []).map((r) => {
      const m = (r.metadata as Record<string, unknown>) || {};
      return `${m.field}::${(m.proposed_value as string) || ""}`.toLowerCase();
    }),
  );
  return proposals.filter(
    (p) => !existing.has(`${p.field}::${p.proposed_value}`.toLowerCase()),
  );
}

async function persistProposals(
  userId: string,
  proposals: AtomicProposal[],
  scanMeta: Record<string, unknown>,
): Promise<number> {
  if (proposals.length === 0) return 0;
  const rows = proposals.map((p) => ({
    user_id: userId,
    proposal_type: `personality_${p.field}`,
    title: p.title.slice(0, 200),
    description: p.description,
    patch_text: null,
    status: "pending",
    metadata: {
      field: p.field,
      current_value: p.current_value,
      proposed_value: p.proposed_value,
      evidence: p.evidence,
      ...scanMeta,
    },
  }));
  const { error } = await sb.from("system_evolution_proposals").insert(rows);
  if (error) {
    console.error("[evolve] insert failed", error);
    return 0;
  }
  return rows.length;
}

// Always insert a "scan marker" proposal-row? No — store last_scan_at on a
// no-op row only if zero proposals, so the watermark exists. Cheaper: rely on
// most recent created_at across user's proposals, OR insert nothing and use
// chat_messages.created_at as fallback. We'll use the latter (no-op if empty).

// ----- Per-user run -------------------------------------------------------

async function runForUser(userId: string): Promise<{
  user_id: string;
  status: string;
  proposals_added: number;
  reason?: string;
}> {
  const msgs = await loadRecentMessages(userId);
  const decision = await shouldExtract(userId, msgs);
  if (!decision.go) {
    return { user_id: userId, status: "skipped", proposals_added: 0, reason: decision.reason };
  }

  const personality = await loadPersonality(userId);
  const lastExtraction = await getLastExtractionAt(userId);
  const newMsgs = lastExtraction
    ? msgs.filter((m) => new Date(m.created_at) > lastExtraction)
    : msgs;

  const proposals = await extractProposals(personality, newMsgs);
  const fresh = await dedupe(userId, proposals);
  const added = await persistProposals(userId, fresh, {
    last_scan_at: new Date().toISOString(),
    trigger: decision.reason,
    msgs_scanned: newMsgs.length,
  });

  return { user_id: userId, status: "extracted", proposals_added: added, reason: decision.reason };
}

// Discover users active in last 24h
async function discoverActiveUsers(): Promise<string[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("chat_messages")
    .select("user_id")
    .gte("created_at", since)
    .limit(1000);
  const uniq = new Set<string>();
  (data || []).forEach((r) => uniq.add(r.user_id as string));
  return Array.from(uniq);
}

// ----- HTTP entry ---------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    let body: { user_id?: string } = {};
    if (req.method === "POST") {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }

    if (body.user_id) {
      const result = await runForUser(body.user_id);
      return new Response(JSON.stringify({ ok: true, mode: "single", result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cron path: scan all active users
    const users = await discoverActiveUsers();
    const results = [];
    for (const uid of users) {
      try {
        results.push(await runForUser(uid));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({ user_id: uid, status: "error", proposals_added: 0, reason: msg });
      }
    }
    const summary = {
      ok: true,
      mode: "cron",
      users_scanned: users.length,
      proposals_total: results.reduce((s, r) => s + (r.proposals_added || 0), 0),
      results,
    };
    console.log("[evolve] cron summary", JSON.stringify(summary));
    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[evolve] fatal", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
