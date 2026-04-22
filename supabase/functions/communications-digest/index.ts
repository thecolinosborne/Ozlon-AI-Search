// Communications digest — calls the aggregator and produces a hero line,
// sub line and a short voice-ready brief script. Uses Lovable AI for a
// chief-of-staff style summary; falls back to deterministic counts otherwise.

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

function fallbackBriefScript(stream: CommMessage[], priorities: PriorityItem[]): string {
  if (priorities.length === 0) {
    return `${greet()}. Inbox is quiet — ${stream.length} messages and nothing urgent. Take the win.`;
  }
  const lines = priorities
    .slice(0, 3)
    .map((p) => `${p.who} on ${p.channelLabel} — ${p.what}.`)
    .join(" ");
  return `${greet()}. ${priorities.length} ${priorities.length === 1 ? "thing needs" : "things need"} you. ${lines} Want me to draft replies?`;
}

function fallbackHero(priorities: PriorityItem[]): string {
  return priorities.length === 0
    ? "You're caught up."
    : `${priorities.length} ${priorities.length === 1 ? "thing needs" : "things need"} you today.`;
}

function fallbackSub(stream: CommMessage[], sourceCounts: Record<string, number>): string {
  const channelsActive = Object.values(sourceCounts).filter((v) => (v as number) > 0).length;
  return stream.length === 0
    ? "Nothing new since yesterday."
    : `${stream.length} messages across ${channelsActive} ${channelsActive === 1 ? "channel" : "channels"}.`;
}

interface AIDigest {
  heroLine?: string;
  subLine?: string;
  briefScript?: string;
}

async function aiDigest(
  stream: CommMessage[],
  priorities: PriorityItem[],
  sourceCounts: Record<string, number>,
): Promise<AIDigest | null> {
  if (!LOVABLE_API_KEY) return null;
  try {
    const top = priorities
      .map((p, i) => `${i + 1}. ${p.who} (${p.channelLabel}): ${p.what}`)
      .join("\n");
    const counts = Object.entries(sourceCounts)
      .filter(([, v]) => (v as number) > 0)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ");

    const userMsg = priorities.length
      ? `Time of day: ${greet()}.\nTotal messages: ${stream.length} (${counts || "none"}).\nTop priorities:\n${top}`
      : `Time of day: ${greet()}.\nTotal messages: ${stream.length} (${counts || "none"}).\nNo urgent items — caught up.`;

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
              "You are a calm, concise chief-of-staff briefing one user on their inbox. Respond with ONLY a JSON object with three string fields: heroLine, subLine, briefScript.\n" +
              "- heroLine: 6-12 words. Name the single most important thing or person. Never just a count. If caught up, say so warmly.\n" +
              "- subLine: 6-14 words. One line of texture about the volume and shape of the inbox (e.g. '3 from clients, 1 from your team, nothing on fire.'). No counts-only.\n" +
              "- briefScript: 2-3 short sentences for text-to-speech. Conversational, no markdown, no lists. End with one offer to help.",
          },
          { role: "user", content: userMsg },
        ],
      }),
    });

    if (!res.ok) {
      console.warn("[digest] AI failed", res.status);
      return null;
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return {
        heroLine: typeof parsed.heroLine === "string" ? parsed.heroLine.trim() : undefined,
        subLine: typeof parsed.subLine === "string" ? parsed.subLine.trim() : undefined,
        briefScript: typeof parsed.briefScript === "string" ? parsed.briefScript.trim() : undefined,
      };
    } catch {
      console.warn("[digest] AI returned non-JSON");
      return null;
    }
  } catch (e) {
    console.warn("[digest] AI threw:", e instanceof Error ? e.message : e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");

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

  const ai = await aiDigest(stream, priorities, sourceCounts);

  const heroLine = ai?.heroLine || fallbackHero(priorities);
  const subLine = ai?.subLine || fallbackSub(stream, sourceCounts);
  const briefScript = ai?.briefScript || fallbackBriefScript(stream, priorities);

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
