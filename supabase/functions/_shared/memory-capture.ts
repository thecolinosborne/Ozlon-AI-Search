// ============================================================================
// Universal memory capture helper.
// Writes any business action, resource, decision, or fact into wisdom_memories
// with an embedding so it can be recalled semantically across sessions.
// ============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type MemoryResourceType =
  | "fact"
  | "preference"
  | "pattern"
  | "context"
  | "goal"
  | "value"
  | "task"
  | "contact"
  | "event"
  | "email"
  | "doc"
  | "file"
  | "decision"
  | "issue"
  | "rock"
  | "metric"
  | "action";

export interface SaveMemoryInput {
  user_id: string;
  session_id?: string | null;
  memory_type?: MemoryResourceType;
  content: string;           // full detail
  summary: string;           // 1-line title
  resource_type?: MemoryResourceType; // semantic category for filtering
  source_tool?: string;      // e.g. "clickup", "gohighlevel", "google-calendar"
  external_id?: string;      // tool-specific id (task id, contact id, event id)
  external_url?: string;     // deep link
  salience?: number;         // 0-1 importance
  metadata?: Record<string, unknown>;
}

let adminSingleton: SupabaseClient | null = null;
function adminClient(): SupabaseClient {
  if (!adminSingleton) {
    adminSingleton = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
  }
  return adminSingleton;
}

const LOVABLE_EMBEDDINGS_URL = "https://ai.gateway.lovable.dev/v1/embeddings";

async function embed(text: string): Promise<number[]> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetch(LOVABLE_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text.slice(0, 8000),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Embedding failed: ${res.status} ${body}`);
  }
  const json = await res.json() as { data?: { embedding: number[] }[] };
  return json.data?.[0]?.embedding ?? [];
}

/** Save a memory. If a near-duplicate exists, update its recurrence count. */
export async function saveMemory(opts: SaveMemoryInput): Promise<{ id: string; updated: boolean }> {
  const admin = adminClient();
  const content = opts.content.trim();
  const summary = (opts.summary || content.split(/\n/)[0]).slice(0, 200).trim();
  if (!content || !summary) throw new Error("content and summary are required");

  const embedding = await embed(content);
  if (!embedding.length) throw new Error("empty embedding");

  const memoryType = opts.memory_type || opts.resource_type || "fact";
  const resourceType = opts.resource_type || opts.memory_type || "fact";

  // Deduplication: very similar existing memory for this user
  const { data: similar } = await admin.rpc("match_wisdom_memories", {
    query_embedding: JSON.stringify(embedding),
    match_threshold: 0.92,
    match_count: 1,
    filter_user_id: opts.user_id,
    filter_memory_type: null,
  });

  const existing = (similar ?? [])[0] as { id: string; recurrence_count: number; confidence: number; salience: number } | undefined;
  if (existing) {
    const { error } = await admin.from("wisdom_memories").update({
      recurrence_count: (existing.recurrence_count || 1) + 1,
      confidence: Math.min((existing.confidence || 0.8) + 0.05, 1.0),
      content,
      summary,
      salience: Math.max(existing.salience || 0.5, opts.salience || 0.6),
      source_tool: opts.source_tool || null,
      external_id: opts.external_id || null,
      external_url: opts.external_url || null,
      resource_type: resourceType,
      session_id: opts.session_id || null,
      metadata: opts.metadata ? JSON.parse(JSON.stringify(opts.metadata)) : {},
      updated_at: new Date().toISOString(),
      last_accessed_at: new Date().toISOString(),
    }).eq("id", existing.id);
    if (error) throw error;
    return { id: existing.id, updated: true };
  }

  const { data, error } = await admin.from("wisdom_memories").insert({
    user_id: opts.user_id,
    session_id: opts.session_id || null,
    memory_type: memoryType,
    content,
    summary,
    embedding: JSON.stringify(embedding),
    salience: opts.salience ?? 0.6,
    confidence: 0.85,
    source_tool: opts.source_tool || null,
    external_id: opts.external_id || null,
    external_url: opts.external_url || null,
    resource_type: resourceType,
    metadata: opts.metadata ? JSON.parse(JSON.stringify(opts.metadata)) : {},
  }).select("id").single();
  if (error) throw error;
  return { id: data!.id, updated: false };
}

/** Create a directional link between two memories. */
export async function linkMemories(
  userId: string,
  sourceId: string,
  targetId: string,
  relationship: "created_from" | "related_to" | "follow_up_to" | "mentions" | "derived_from" = "related_to",
  metadata?: Record<string, unknown>,
): Promise<void> {
  const admin = adminClient();
  const { error } = await admin.from("memory_links").insert({
    user_id: userId,
    source_memory_id: sourceId,
    target_memory_id: targetId,
    relationship,
    metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : {},
  });
  if (error) {
    // Ignore unique-violation-like duplicate links
    if (!error.message?.includes("duplicate") && error.code !== "23505") throw error;
  }
}

/** Lightweight keyword search over wisdom_memories for a user. */
export async function searchMemories(
  userId: string,
  query: string,
  opts: { resource_type?: string; limit?: number; threshold?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const admin = adminClient();
  const embedding = await embed(query);
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 20);
  let rows: Array<Record<string, unknown>> = [];

  if (embedding.length) {
    const { data, error } = await admin.rpc("match_wisdom_memories", {
      query_embedding: JSON.stringify(embedding),
      match_threshold: opts.threshold ?? 0.5,
      match_count: limit,
      filter_user_id: userId,
      filter_memory_type: opts.resource_type || null,
    });
    if (error) console.warn("[searchMemories] semantic error:", error.message);
    else rows = (data ?? []) as Array<Record<string, unknown>>;
  }

  // Keyword safety net for short/exact queries and freshly-inserted test rows.
  if (rows.length < limit && query.trim().length >= 3) {
    const words = query.toLowerCase().match(/[a-z0-9']+/g)?.filter((w) => w.length >= 3) ?? [];
    const conditions = words.map((w) => {
      const escaped = w.replace(/[%_]/g, "\\$&");
      return `content.ilike.%${escaped}%,summary.ilike.%${escaped}%,source_tool.ilike.%${escaped}%`;
    });
    if (conditions.length) {
      let kwQuery = admin
        .from("wisdom_memories")
        .select("*")
        .eq("user_id", userId)
        .or(conditions.join(","));
      if (opts.resource_type) kwQuery = kwQuery.eq("resource_type", opts.resource_type);
      const { data: kwRows, error: kwErr } = await kwQuery.limit(limit - rows.length);
      if (kwErr) console.warn("[searchMemories] keyword error:", kwErr.message);
      const seen = new Set(rows.map((r) => String(r.id)));
      for (const r of (kwRows ?? [])) {
        if (!seen.has(String(r.id))) rows.push(r);
      }
    }
  }

  return rows;
}

/** Convenience: capture the result of a tool call as a memory. */
export async function captureToolMemory(opts: {
  user_id: string;
  session_id?: string | null;
  tool: string;
  action: string;
  resource_type: MemoryResourceType;
  external_id?: string;
  external_url?: string;
  title: string;
  detail: string;
  metadata?: Record<string, unknown>;
  link_to?: string; // source memory id this result was derived from
}): Promise<{ id: string; updated: boolean }> {
  const result = await saveMemory({
    user_id: opts.user_id,
    session_id: opts.session_id,
    memory_type: "action",
    resource_type: opts.resource_type,
    source_tool: opts.tool,
    external_id: opts.external_id,
    external_url: opts.external_url,
    summary: `${opts.action}: ${opts.title}`,
    content: opts.detail,
    salience: 0.65,
    metadata: { action: opts.action, tool: opts.tool, ...(opts.metadata || {}) },
  });
  if (opts.link_to) {
    try {
      await linkMemories(opts.user_id, opts.link_to, result.id, "created_from");
    } catch { /* ignore */ }
  }
  return result;
}
