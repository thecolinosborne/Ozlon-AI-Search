// Channel-aware AI reply draft generator. Returns a single short draft string
// tailored to the channel norms (email vs slack vs sms vs voicemail).

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

type Channel = "email" | "slack" | "sms" | "voicemail";
type Tone = "default" | "shorter" | "friendlier" | "firmer";

interface DraftRequest {
  channel: Channel;
  fromName: string;
  channelLabel?: string;
  subject?: string;
  preview: string;
  tone?: Tone;
}

function fallbackDraft(req: DraftRequest): string {
  const first = (req.fromName || "").split(" ")[0] || "there";
  switch (req.channel) {
    case "email":
      return `Hi ${first},\n\nThanks for the note — got it and I'll get back to you shortly with specifics.\n\nBest,`;
    case "slack":
      return `thanks — taking a look now and will follow up in thread.`;
    case "sms":
      return `Got it — will get back to you shortly.`;
    case "voicemail":
      return `Hey ${first}, got your voicemail — calling you back shortly.`;
    default:
      return `Thanks — I'll follow up shortly.`;
  }
}

function systemPromptFor(channel: Channel, tone: Tone): string {
  const toneNote =
    tone === "shorter"
      ? " Make it noticeably shorter than a typical reply."
      : tone === "friendlier"
        ? " Lean warmer and more personable, but stay professional."
        : tone === "firmer"
          ? " Be direct and decisive, no hedging."
          : "";

  const base =
    "You draft short, ready-to-send replies on behalf of a busy professional. Match the tone and length to the channel exactly. Output ONLY the reply text — no preface, no explanation, no quotes, no markdown.";

  switch (channel) {
    case "email":
      return `${base} Channel: EMAIL. 2–4 sentences. Greet by first name. Acknowledge the specific point in the message. Sign off with "Best," on its own line (no name — the user adds it).${toneNote}`;
    case "slack":
      return `${base} Channel: SLACK. 1–2 sentences, lowercase-friendly, conversational. NO greeting, NO signoff, NO "Hi". Reference what they said. Emojis only if natural.${toneNote}`;
    case "sms":
      return `${base} Channel: SMS. ONE sentence, casual, under 160 characters. No greeting, no signoff.${toneNote}`;
    case "voicemail":
      return `${base} Channel: VOICEMAIL CALLBACK NOTE. ONE sentence acknowledging the voicemail and committing to call back. Casual, like a quick text reply.${toneNote}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: DraftRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body?.channel || !body?.preview || !body?.fromName) {
    return new Response(JSON.stringify({ error: "channel, fromName, preview required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const tone: Tone = body.tone ?? "default";

  if (!LOVABLE_API_KEY) {
    return new Response(
      JSON.stringify({ draft: fallbackDraft(body), source: "fallback" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const userContent = [
      `From: ${body.fromName}`,
      body.subject ? `Subject: ${body.subject}` : null,
      body.channelLabel ? `Channel: ${body.channelLabel}` : null,
      "",
      "Message:",
      body.preview,
    ]
      .filter(Boolean)
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
          { role: "system", content: systemPromptFor(body.channel, tone) },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!res.ok) {
      console.warn("[comms-draft] AI failed", res.status);
      return new Response(
        JSON.stringify({ draft: fallbackDraft(body), source: "fallback" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await res.json();
    let draft = (data?.choices?.[0]?.message?.content ?? "").trim();
    // Strip wrapping quotes if model added them
    if ((draft.startsWith('"') && draft.endsWith('"')) || (draft.startsWith("'") && draft.endsWith("'"))) {
      draft = draft.slice(1, -1).trim();
    }
    if (!draft) draft = fallbackDraft(body);

    return new Response(JSON.stringify({ draft, source: "ai" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.warn("[comms-draft] threw", e instanceof Error ? e.message : e);
    return new Response(
      JSON.stringify({ draft: fallbackDraft(body), source: "fallback" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
