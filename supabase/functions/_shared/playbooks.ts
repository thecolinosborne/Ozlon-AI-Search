// ============= Playbooks: the assistant that learns what Colin repeats =============
// Watches each chat turn, counts what Colin keeps asking for, and teaches the
// assistant to turn repeated work into saved routines (scheduled_routines) so
// output happens without him asking twice.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function admin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// Keyword buckets → human labels. Deliberately simple and deterministic:
// a wrong guess costs nothing, a missed pattern costs a repeated chore.
const SIGNATURES: Array<[RegExp, string, string, string]> = [
  [/\b(email|inbox|gmail|unread|reply to)\b/i, "email", "Checking and handling email", "a morning inbox triage that drafts the replies you owe"],
  [/\b(calendar|schedule|meeting|book a|appointment)\b/i, "calendar", "Managing the calendar", "a daily schedule rundown with conflicts flagged"],
  [/\b(clickup|task|subtask|to-?do list)\b/i, "tasks", "Working the task list", "a routine that pulls today's tasks and pushes the stale ones forward"],
  [/\b(research|find out|look into|dig into|competitor)\b/i, "research", "Research requests", "a scheduled research sweep on the topics you track"],
  [/\b(browse|website|go to|log ?in|bank|balance|fill (out|in))\b/i, "browser", "Browser errands", "a saved browser playbook for the sites you visit often"],
  [/\b(event|networking|meetup|rsvp)\b/i, "events", "Hunting networking events", "a weekly event scout for Lake Norman business events"],
  [/\b(ghl|gohighlevel|crm|contact|lead|pipeline)\b/i, "crm", "Working the CRM", "a lead check-in that summarizes new contacts and stale deals"],
  [/\b(document|pdf|upload|scan|read this file)\b/i, "documents", "Reading documents", "a document digest whenever you upload files"],
  [/\b(post|social|instagram|linkedin|content)\b/i, "content", "Creating content", "a weekly content drafting session in your voice"],
  [/\b(invoice|payment|money|financ|expense|revenue)\b/i, "money", "Money check-ins", "a weekly money snapshot from your accounts"],
  [/\b(cleaning company|avalon|business|client)\b/i, "business", "Moving the businesses forward", "a weekly scorecard per business with the next move for each"],
];

export async function recordTurnActivity(userId: string, userText: string): Promise<void> {
  if (!userId || !userText) return;
  try {
    const hits = SIGNATURES.filter(([re]) => re.test(userText));
    if (!hits.length) return;
    const db = admin();
    for (const [, key, label, suggestion] of hits.slice(0, 3)) {
      // Upsert by hand: increment count, refresh label/suggestion.
      const { data } = await db
        .from("activity_patterns")
        .select("id, count")
        .eq("user_id", userId)
        .eq("pattern_key", key)
        .maybeSingle();
      if (data) {
        await db
          .from("activity_patterns")
          .update({ count: (data.count ?? 0) + 1, last_seen_at: new Date().toISOString(), suggestion })
          .eq("id", data.id);
      } else {
        await db.from("activity_patterns").insert({ user_id: userId, pattern_key: key, label, suggestion });
      }
    }
  } catch (e) {
    console.error("[playbooks] record failed:", e);
  }
}

export async function buildPlaybookContext(userId: string): Promise<string> {
  if (!userId) return "";
  try {
    const db = admin();
    const [{ data: patterns }, { data: routines }] = await Promise.all([
      db
        .from("activity_patterns")
        .select("label, count, suggestion, status")
        .eq("user_id", userId)
        .order("count", { ascending: false })
        .limit(8),
      db
        .from("scheduled_routines")
        .select("name, cron_expression, active, run_count, last_run_status")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    const lines: string[] = [];
    const repeated = (patterns || []).filter((p) => (p.count ?? 0) >= 3 && p.status !== "automated");
    if (repeated.length) {
      lines.push("Things Colin keeps doing (offer to automate these — once, naturally, not every turn):");
      for (const p of repeated) lines.push(`- ${p.label} (${p.count}x) — could become ${p.suggestion}`);
    }
    if (routines?.length) {
      lines.push("Automations already running (never offer to recreate these; mention results when relevant):");
      for (const r of routines) lines.push(`- ${r.name} — ${r.active ? "active" : "paused"}, ran ${r.run_count ?? 0}x, last run ${r.last_run_status || "never"}`);
    }
    if (!lines.length) return "";
    return `LEARNED PATTERNS:\n${lines.join("\n")}`;
  } catch (e) {
    console.error("[playbooks] context failed:", e);
    return "";
  }
}

export async function markPatternAutomated(userId: string, patternKey?: string): Promise<void> {
  if (!userId) return;
  try {
    const db = admin();
    if (patternKey) {
      await db.from("activity_patterns").update({ status: "automated" }).eq("user_id", userId).eq("pattern_key", patternKey);
    }
  } catch { /* non-fatal */ }
}

export const PLAYBOOK_FRAME = `LEARNING COLIN: You are not a reset button — you learn how he works. When LEARNED PATTERNS shows something he does 3+ times that is not yet automated, offer once, in one short sentence, to make it automatic (e.g. "You check this every morning — want me to just do it and have it in your inbox by 7?"). If he says yes, use create_routine with a clear name, a cron schedule you translate into plain words for him, and a prompt that is completely self-contained: routines run unattended, so the prompt must include every detail (recipient email addresses, which accounts, what "industry" means, exactly what to produce) and must instruct "never ask questions — make a sensible assumption and note it." If any detail is missing, ask Colin BEFORE creating the routine, not inside it. If he says no, never offer that one again. When an automation runs, its results reach him through the daily brief — say that plainly. Proactively suggest the next output multiplier when the opening is obvious (a repeated chore, a manual report, a weekly check-in), but one suggestion per conversation at most, and never interrupt a task in flight to pitch it.`;
