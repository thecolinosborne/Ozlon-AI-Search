// Communications triage — takes the user's recent stream and returns
// per-message AI judgments: urgency, reason, suggested action, and (for
// messages that need a reply) a short suggested reply draft.
//
// Output shape (envelope):
//   { ok: true, data: { items: TriageItem[] }, diagnostics: { aiUsed, count } }
//
// TriageItem: { messageId, urgency: 'high'|'medium'|'low', reason: string,
//               actionHint: 'reply'|'schedule'|'snooze'|'done'|'ignore',
//               suggestedReply?: string }

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

interface CommMessage {
  id: string;
  channel: "email" | "slack" | "sms" | "voicemail";
  fromName: string;
  channelLabel: string;
  subject?: string;
  preview: string;
  receivedAt: string;
  isUnread: boolean;
  needsReply: boolean;
}

interface TriageItem {
  messageId: string;
  urgency: "high" | "medium" | "low";
  reason: string;
  actionHint: "reply" | "schedule" | "snooze" | "done" | "ignore";
  suggestedReply?: string;
}

const ACTIONS = ["reply", "schedule", "snooze", "done", "ignore"] as const;
const URGENCIES = ["high", "medium", "low"] as const;

function clampUrgency(v: unknown): TriageItem["urgency"] {
  return URGENCIES.includes(v as TriageItem["urgency"])
    ? (v as TriageItem["urgency"])
    : "medium";
}
function clampAction(v: unknown): TriageItem["actionHint"] {
  return ACTIONS.includes(v as TriageItem["actionHint"])
    ? (v as TriageItem["actionHint"])
    : "reply";
}

async function aiTriage(stream: CommMessage[]): Promise<TriageItem[] | null> {
  if (!LOVABLE_API_KEY || stream.length === 0) return null;

  // Trim to the most signal-rich messages to keep the prompt cheap.
  const candidates = stream
    .filter((m) => m.isUnread || m.needsReply)
    .slice(0, 10);
  if (candidates.length === 0) return [];

  const lines = candidates.map((m, i) => {
    const subj = m.subject ? ` | subject: ${m.subject}` : "";
    return `${i + 1}. id=${m.id} | from=${m.fromName} | ch=${m.channelLabel}${subj} | preview: ${(m.preview ?? "").slice(0, 240)}`;
  }).join("\n");

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a chief-of-staff triaging an inbox. For each message, decide:\n" +
              "- urgency: high | medium | low (high = needs reply today, low = informational)\n" +
              "- reason: <=12 words, plain text, why this rating\n" +
              "- actionHint: reply | schedule | snooze | done | ignore\n" +
              "- suggestedReply: 1-2 sentences, only if actionHint='reply'. Match the channel tone (formal for email, casual for slack/sms). No greeting fluff for chat channels.\n" +
              "Return ONLY a JSON object: { \"items\": [{ \"messageId\": string, \"urgency\": string, \"reason\": string, \"actionHint\": string, \"suggestedReply\": string|null }] }. Use the EXACT id from the input.",
          },
          { role: "user", content: `Messages:\n${lines}` },
        ],
      }),
    });
    if (!res.ok) {
      console.warn("[triage] AI failed", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return items.map((it: Record<string, unknown>): TriageItem => ({
      messageId: String(it.messageId ?? ""),
      urgency: clampUrgency(it.urgency),
      reason: typeof it.reason === "string" ? it.reason.slice(0, 140) : "",
      actionHint: clampAction(it.actionHint),
      suggestedReply:
        typeof it.suggestedReply === "string" && it.suggestedReply.trim().length > 0
          ? it.suggestedReply.slice(0, 800)
          : undefined,
    })).filter((it: TriageItem) => it.messageId);
  } catch (e) {
    console.warn("[triage] threw:", e instanceof Error ? e.message : e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");

  // Pull the latest stream from the aggregator (read-only, cheap).
  let stream: CommMessage[] = [];
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/communications-aggregate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: "{}",
    });
    const data = await res.json();
    stream = (data?.data?.stream ?? data?.stream ?? []) as CommMessage[];
  } catch (e) {
    console.warn("[triage] aggregate failed:", e instanceof Error ? e.message : e);
  }

  const items = (await aiTriage(stream)) ?? [];

  return new Response(
    JSON.stringify({
      ok: true,
      data: { items },
      diagnostics: { aiUsed: !!LOVABLE_API_KEY, count: items.length, streamSize: stream.length },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
