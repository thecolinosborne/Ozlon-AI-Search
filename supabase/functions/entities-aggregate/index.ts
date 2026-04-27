// People aggregator: builds/refreshes the entity graph from existing
// communications_messages + email_attachments. Idempotent, fast, on-demand.
// Returns the user's people sorted by importance.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AnyJson = Record<string, unknown>;

function parseEmail(handle: string): { name: string; email: string } {
  const s = (handle || "").trim();
  const m = s.match(/^(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, "").trim() || m[2].split("@")[0], email: m[2].trim().toLowerCase() };
  if (s.includes("@")) return { name: s.split("@")[0], email: s.toLowerCase() };
  return { name: s, email: s.toLowerCase() };
}

function inferType(email: string, name: string): string {
  const e = email.toLowerCase();
  const n = name.toLowerCase();
  if (/noreply|no-reply|notifications?@|support@|hello@|info@|team@|billing@|alerts?@|updates?@/.test(e)) return "system";
  if (/\b(inc|llc|corp|ltd|co\.|company|bank|airlines?|store|shop)\b/.test(n)) return "org";
  return "person";
}

function importance(interactionCount: number, daysSinceLast: number, type: string): number {
  const recency = Math.exp(-daysSinceLast / 14); // decays over 2 weeks
  const freq = Math.min(1, interactionCount / 20);
  const typeBoost = type === "person" ? 1.2 : type === "org" ? 0.8 : 0.4;
  return Math.min(1, (recency * 0.5 + freq * 0.5) * typeBoost);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    const refresh = url.searchParams.get("refresh") === "1";

    if (refresh) {
      // Pull recent communications messages
      const { data: msgs } = await admin
        .from("communications_messages")
        .select("from_handle, from_name, channel, received_at")
        .eq("user_id", userId)
        .order("received_at", { ascending: false })
        .limit(2000);

      // Pull recent email attachments
      const { data: atts } = await admin
        .from("email_attachments")
        .select("sender, sender_email, received_at")
        .eq("user_id", userId)
        .order("received_at", { ascending: false })
        .limit(1000);

      // Aggregate by (channel, identifier)
      const buckets = new Map<string, {
        channel: string;
        identifier: string;
        name: string;
        count: number;
        lastAt: string;
      }>();

      const push = (channel: string, identifier: string, name: string, ts?: string) => {
        if (!identifier) return;
        const key = `${channel}::${identifier.toLowerCase()}`;
        const cur = buckets.get(key);
        if (cur) {
          cur.count++;
          if (ts && (!cur.lastAt || ts > cur.lastAt)) cur.lastAt = ts;
          if (name && (!cur.name || cur.name === cur.identifier)) cur.name = name;
        } else {
          buckets.set(key, { channel, identifier: identifier.toLowerCase(), name: name || identifier, count: 1, lastAt: ts || new Date().toISOString() });
        }
      };

      for (const m of msgs || []) {
        const ch = String((m as AnyJson).channel || "email");
        const handle = String((m as AnyJson).from_handle || "");
        const name = String((m as AnyJson).from_name || "");
        const ts = String((m as AnyJson).received_at || "");
        if (ch === "email" || ch === "gmail") {
          const { email, name: parsedName } = parseEmail(handle);
          push("email", email, name || parsedName, ts);
        } else {
          push(ch, handle, name, ts);
        }
      }
      for (const a of atts || []) {
        const email = String((a as AnyJson).sender_email || "").toLowerCase();
        const name = String((a as AnyJson).sender || "");
        const ts = String((a as AnyJson).received_at || "");
        if (email) push("email", email, name, ts);
      }

      // Group by canonical entity (for v1: by primary email or first identifier)
      // Simple: each unique (channel, identifier) becomes its own entity unless
      // we find an existing entity_identity row for it.
      const now = Date.now();
      for (const b of buckets.values()) {
        // Lookup existing identity
        const { data: existing } = await admin
          .from("entity_identities")
          .select("entity_id")
          .eq("user_id", userId)
          .eq("channel", b.channel)
          .eq("identifier", b.identifier)
          .maybeSingle();

        const days = b.lastAt ? Math.max(0, (now - new Date(b.lastAt).getTime()) / 86400000) : 9999;
        const type = b.channel === "email" ? inferType(b.identifier, b.name) : "person";
        const score = importance(b.count, days, type);
        const channelCounts: AnyJson = { [b.channel]: b.count };

        if (existing?.entity_id) {
          await admin
            .from("entities")
            .update({
              display_name: b.name || b.identifier,
              importance_score: score,
              last_interaction_at: b.lastAt,
              interaction_count: b.count,
              channel_counts: channelCounts,
            })
            .eq("id", existing.entity_id);
        } else {
          const { data: newEntity } = await admin
            .from("entities")
            .insert({
              user_id: userId,
              display_name: b.name || b.identifier,
              entity_type: type,
              primary_email: b.channel === "email" ? b.identifier : null,
              importance_score: score,
              last_interaction_at: b.lastAt,
              interaction_count: b.count,
              channel_counts: channelCounts,
            })
            .select("id")
            .single();
          if (newEntity?.id) {
            await admin.from("entity_identities").insert({
              user_id: userId,
              entity_id: newEntity.id,
              channel: b.channel,
              identifier: b.identifier,
              display_label: b.name || b.identifier,
            });
          }
        }
      }
    }

    // Return ranked entities
    const { data: entities, error } = await admin
      .from("entities")
      .select("*")
      .eq("user_id", userId)
      .order("starred", { ascending: false })
      .order("importance_score", { ascending: false })
      .order("last_interaction_at", { ascending: false, nullsFirst: false })
      .limit(200);

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, entities: entities || [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[entities-aggregate]", e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
