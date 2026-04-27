// Entity Space: returns the unified timeline for one entity (all messages,
// attachments, future channels) + an on-demand AI relationship summary.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AnyJson = Record<string, unknown>;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userClient.auth.getUser();
    const userId = u?.user?.id;
    if (!userId) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : Object.fromEntries(new URL(req.url).searchParams);
    const entityId = String((body as AnyJson).entity_id || "");
    const wantSummary = Boolean((body as AnyJson).summary);
    if (!entityId) return new Response(JSON.stringify({ error: "entity_id required" }), { status: 400, headers: corsHeaders });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: entity } = await admin.from("entities").select("*").eq("id", entityId).eq("user_id", userId).maybeSingle();
    if (!entity) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: corsHeaders });

    const { data: identities } = await admin
      .from("entity_identities")
      .select("channel, identifier")
      .eq("user_id", userId)
      .eq("entity_id", entityId);

    const emails = (identities || []).filter((i: AnyJson) => i.channel === "email").map((i: AnyJson) => String(i.identifier));

    // Pull comm messages from these identifiers
    const { data: msgs } = emails.length ? await admin
      .from("communications_messages")
      .select("id, channel, subject, preview, body_text, from_name, from_handle, received_at, is_unread, audio_url, channel_label")
      .eq("user_id", userId)
      .or(emails.map((e) => `from_handle.ilike.%${e}%`).join(","))
      .order("received_at", { ascending: false })
      .limit(100) : { data: [] };

    // Attachments from this entity
    const { data: atts } = emails.length ? await admin
      .from("email_attachments")
      .select("id, filename, mime_type, size_bytes, summary, received_at, message_id, status")
      .eq("user_id", userId)
      .in("sender_email", emails)
      .order("received_at", { ascending: false })
      .limit(50) : { data: [] };

    // Build unified timeline
    type TimelineItem = { kind: string; at: string; data: AnyJson };
    const timeline: TimelineItem[] = [];
    for (const m of msgs || []) timeline.push({ kind: "message", at: String((m as AnyJson).received_at), data: m as AnyJson });
    for (const a of atts || []) timeline.push({ kind: "attachment", at: String((a as AnyJson).received_at), data: a as AnyJson });
    timeline.sort((a, b) => (a.at < b.at ? 1 : -1));

    let summary: string | null = entity.relationship_summary as string | null;
    if (wantSummary) {
      const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (LOVABLE_KEY && timeline.length) {
        const sample = timeline.slice(0, 30).map((t) => {
          if (t.kind === "message") {
            const d = t.data;
            return `[${t.at}] ${d.subject || "(no subject)"}\n${String(d.preview || d.body_text || "").slice(0, 300)}`;
          }
          return `[${t.at}] ATTACHMENT: ${t.data.filename} — ${String(t.data.summary || "").slice(0, 200)}`;
        }).join("\n\n");
        try {
          const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [{
                role: "user",
                content: `Based on these recent communications with ${entity.display_name}, write a concise 3-4 sentence relationship summary. Focus on: who they are to me, what we've been discussing, any open threads or commitments. Calm, factual tone. No bullet points.\n\n${sample}`,
              }],
            }),
          });
          if (r.ok) {
            const j = await r.json();
            summary = String(j?.choices?.[0]?.message?.content || "").trim();
            await admin.from("entities").update({ relationship_summary: summary }).eq("id", entityId);
          }
        } catch (_) { /* best-effort */ }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      entity: { ...entity, relationship_summary: summary },
      identities: identities || [],
      timeline,
      counts: { messages: (msgs || []).length, attachments: (atts || []).length },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[entity-space]", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), { status: 500, headers: corsHeaders });
  }
});
