// ============================================================================
// memory-search — unified semantic search over Ozlon's memory layer.
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const LOVABLE_EMBEDDINGS_URL = "https://ai.gateway.lovable.dev/v1/embeddings";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const query = String(body.query || "").trim();
    const resource_type = body.resource_type ? String(body.resource_type) : null;
    const limit = Math.min(Math.max(Number(body.limit ?? 12), 1), 50);
    const mode = String(body.mode || "semantic"); // semantic | keyword | all

    if (!query && mode !== "all") {
      return new Response(JSON.stringify({ error: "query is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const results: Array<Record<string, unknown>> = [];

    // 1) Semantic search over wisdom_memories
    if (mode === "semantic" || mode === "all") {
      const key = Deno.env.get("LOVABLE_API_KEY");
      if (key) {
        const embRes = await fetch(LOVABLE_EMBEDDINGS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": key,
          },
          body: JSON.stringify({ model: "openai/text-embedding-3-small", input: query.slice(0, 8000) }),
        });
        if (embRes.ok) {
          const embJson = await embRes.json() as { data?: { embedding: number[] }[] };
          const embedding = embJson.data?.[0]?.embedding;
          if (embedding?.length) {
            const { data: mems, error: memErr } = await admin.rpc("match_wisdom_memories", {
              query_embedding: JSON.stringify(embedding),
              match_threshold: 0.5,
              match_count: limit,
              filter_user_id: user.id,
              filter_memory_type: resource_type,
            });
            if (!memErr && mems) {
              for (const m of mems as Array<Record<string, unknown>>) {
                results.push({
                  source: "memory",
                  id: m.id,
                  type: m.memory_type || m.resource_type || "fact",
                  resource_type: m.resource_type,
                  summary: m.summary,
                  content: m.content,
                  similarity: m.similarity,
                  source_tool: m.source_tool,
                  external_id: m.external_id,
                  external_url: m.external_url,
                  metadata: m.metadata,
                  created_at: m.created_at,
                  updated_at: m.updated_at,
                });
              }
            }
          }
        }
      }
    }

    // 2) Keyword fallback / all-memories recent list
    if (mode === "keyword" || mode === "all" || results.length === 0) {
      let q = admin
        .from("wisdom_memories")
        .select("*")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(limit * 2);
      if (query) {
        q = q.or(`content.ilike.%${query}%,summary.ilike.%${query}%,source_tool.ilike.%${query}%`);
      }
      if (resource_type) {
        q = q.or(`memory_type.eq.${resource_type},resource_type.eq.${resource_type}`);
      }
      const { data: kwRows, error: kwErr } = await q;
      if (!kwErr && kwRows) {
        const seen = new Set(results.map((r) => r.id as string));
        for (const m of kwRows as Array<Record<string, unknown>>) {
          if (seen.has(m.id as string)) continue;
          results.push({
            source: "memory",
            id: m.id,
            type: m.memory_type || m.resource_type || "fact",
            resource_type: m.resource_type,
            summary: m.summary,
            content: m.content,
            similarity: null,
            source_tool: m.source_tool,
            external_id: m.external_id,
            external_url: m.external_url,
            metadata: m.metadata,
            created_at: m.created_at,
            updated_at: m.updated_at,
          });
        }
      }

      // 3) Artifacts (cross-session docs/tasks/plans)
      const { data: artRows, error: artErr } = await admin
        .from("artifacts")
        .select("*")
        .eq("user_id", user.id)
        .or(`title.ilike.%${query}%,content::text.ilike.%${query}%`)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (!artErr && artRows) {
        for (const a of artRows as Array<Record<string, unknown>>) {
          results.push({
            source: "artifact",
            id: a.id,
            type: a.type,
            resource_type: a.type,
            summary: a.title,
            content: JSON.stringify(a.content).slice(0, 500),
            similarity: null,
            source_tool: (a.external_ref as Record<string, unknown> | undefined)?.provider,
            external_id: (a.external_ref as Record<string, unknown> | undefined)?.taskId || (a.external_ref as Record<string, unknown> | undefined)?.documentId,
            external_url: null,
            metadata: a.external_ref,
            created_at: a.created_at,
            updated_at: a.updated_at,
          });
        }
      }
    }

    // 4) Pull related links for top results
    const topIds = results.slice(0, 6).map((r) => r.id as string).filter(Boolean);
    let links: Array<Record<string, unknown>> = [];
    if (topIds.length) {
      const { data: linkData } = await admin
        .from("memory_links")
        .select("*, target:wisdom_memories!target_memory_id(id, summary, resource_type, external_url)")
        .eq("user_id", user.id)
        .in("source_memory_id", topIds);
      links = (linkData ?? []) as Array<Record<string, unknown>>;
    }

    return new Response(JSON.stringify({ results: results.slice(0, limit), links }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (e) {
    console.error("[memory-search] error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
