// Communications digest — calls the aggregator and produces a hero line,
// priorities and a short voice-ready brief script. Uses Lovable AI when
// available; falls back to a deterministic summary otherwise.

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

interface PriorityItem {
  id: string;
  channel: string;
  who: string;
  what: string;
  channelLabel: string;
}

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

function greet(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function fallbackBrief(stream: CommMessage[], priorities: PriorityItem[]): string {
  if (priorities.length === 0) {
    return `${greet()}. Inbox is quiet — ${stream.length} messages and nothing urgent. Take the win.`;
  }
  const lines = priorities
    .slice(0, 3)
    .map((p) => `${p.who} on ${p.channelLabel} — ${p.what}.`)
    .join(" ");
  return `${greet()}. ${priorities.length} ${priorities.length === 1 ? "thing needs" : "things need"} you. ${lines} Want me to draft replies?`;
}

async function aiBrief(stream: CommMessage[], priorities: PriorityItem[]): Promise<string | null> {
  if (!LOVABLE_API_KEY || priorities.length === 0) return null;
  try {
    const top = priorities
      .map((p, i) => `${i + 1}. ${p.who} (${p.channelLabel}): ${p.what}`)
      .join("\n");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You are a calm, concise voice assistant briefing the user on their inbox. Speak in 2–3 short sentences, conversational, no lists, no markdown. End with one offer to help.",
          },
          {
            role: "user",
            content: `${greet()}. ${stream.length} new messages. Top priorities:\n${top}\n\nBrief me.`,
          },
        ],
      }),
    });
    if (!res.ok) {
      console.warn("[digest] AI brief failed", res.status);
      return null;
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return typeof text === "string" && text.length > 0 ? text : null;
  } catch (e) {
    console.warn("[digest] AI brief threw:", e instanceof Error ? e.message : e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");

  // Pull live aggregate
  let stream: CommMessage[] = [];
  let priorities: PriorityItem[] = [];
  let sourceCounts = { email: 0, slack: 0, sms: 0, voicemail: 0 };
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
    stream = (data.stream || []) as CommMessage[];
    priorities = (data.priorities || []) as PriorityItem[];
    sourceCounts = data.sourceCounts || sourceCounts;
  } catch (e) {
    console.warn("[digest] aggregate failed:", e instanceof Error ? e.message : e);
  }

  const heroLine =
    priorities.length === 0
      ? "You're caught up."
      : `${priorities.length} ${priorities.length === 1 ? "thing needs" : "things need"} you today.`;

  const channelsActive = Object.entries(sourceCounts).filter(([, v]) => (v as number) > 0).length;
  const subLine =
    stream.length === 0
      ? "Nothing new since yesterday."
      : `${stream.length} messages across ${channelsActive} ${channelsActive === 1 ? "channel" : "channels"}.`;

  const briefScript = (await aiBrief(stream, priorities)) || fallbackBrief(stream, priorities);
  // ~2.5 words per second of speech
  const wordCount = briefScript.split(/\s+/).length;
  const briefDurationSec = Math.max(15, Math.min(90, Math.round(wordCount / 2.5)));

  return new Response(
    JSON.stringify({
      heroLine,
      subLine,
      priorities,
      briefScript,
      briefDurationSec,
      generatedAt: new Date().toISOString(),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
