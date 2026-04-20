import { supabase } from "@/integrations/supabase/client";

export type IngestPayload = {
  text: string;
  source_person: string;
  source_material?: string;
  source_type?: string;
  extract_memories?: boolean;
  generate_reflection?: boolean;
};

export type IngestResult = {
  success: boolean;
  source_id?: string;
  entries_count?: number;
  memories_extracted?: number;
  reflection_generated?: boolean;
  error?: string;
};

export type FetchUrlPayload = {
  url: string;
  source_person: string;
  source_material?: string;
  source_type?: string;
  extract_memories?: boolean;
  generate_reflection?: boolean;
};

export type WisdomPack = {
  id: string;
  person: string;
  title: string;
  type: string;
  entry_count: number;
};

export type SearchScope = "all" | "knowledge" | "memory" | "reflection";

export type SearchResultItem = {
  id: string;
  type: "knowledge" | "memory" | "reflection";
  title: string;
  content: string;
  similarity: number;
  weighted_score: number;
  metadata: Record<string, unknown>;
};

export const wisdomService = {
  async ingestText(payload: IngestPayload): Promise<IngestResult> {
    const { data, error } = await supabase.functions.invoke("knowledge-ingest", {
      body: payload,
    });
    if (error) return { success: false, error: error.message };
    return data as IngestResult;
  },

  async ingestChunked(payload: IngestPayload, chunkChars = 40000): Promise<IngestResult[]> {
    const text = payload.text;
    if (text.length <= chunkChars) {
      return [await this.ingestText(payload)];
    }
    // Split on paragraph boundaries when possible
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + chunkChars, text.length);
      let cut = end;
      if (end < text.length) {
        const nl = text.lastIndexOf("\n\n", end);
        if (nl > start + chunkChars * 0.5) cut = nl;
      }
      chunks.push(text.slice(start, cut));
      start = cut;
    }
    const results: IngestResult[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const part: IngestPayload = {
        ...payload,
        text: chunks[i],
        source_material: payload.source_material
          ? `${payload.source_material} (part ${i + 1}/${chunks.length})`
          : undefined,
        // only generate reflection on the last chunk
        generate_reflection: i === chunks.length - 1 ? payload.generate_reflection : false,
      };
      results.push(await this.ingestText(part));
    }
    return results;
  },

  async fetchUrl(payload: FetchUrlPayload): Promise<IngestResult> {
    const { data, error } = await supabase.functions.invoke("knowledge-fetch-url", {
      body: payload,
    });
    if (error) return { success: false, error: error.message };
    return data as IngestResult;
  },

  async listPacks(): Promise<WisdomPack[]> {
    const { data, error } = await supabase.functions.invoke("knowledge-pack-ingest", {
      body: { list: true },
    });
    if (error) {
      console.error("listPacks error:", error);
      return [];
    }
    return (data?.packs as WisdomPack[]) || [];
  },

  async installPack(packId: string): Promise<IngestResult & { already_installed?: boolean }> {
    const { data, error } = await supabase.functions.invoke("knowledge-pack-ingest", {
      body: { pack_id: packId },
    });
    if (error) return { success: false, error: error.message };
    return data;
  },

  async search(
    query: string,
    opts?: { scope?: SearchScope; match_count?: number; threshold?: number },
  ): Promise<{ results: SearchResultItem[]; total: number }> {
    const { data, error } = await supabase.functions.invoke("knowledge-search", {
      body: {
        query,
        scope: opts?.scope ?? "all",
        match_count: opts?.match_count ?? 10,
        threshold: opts?.threshold ?? 0.4,
      },
    });
    if (error) return { results: [], total: 0 };
    return { results: data?.results || [], total: data?.total || 0 };
  },

  async getSources() {
    const { data, error } = await supabase
      .from("knowledge_sources")
      .select("id, person, title, type, entry_count, created_at, is_active")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("getSources error:", error);
      return [];
    }
    return data || [];
  },

  async setSourceActive(sourceId: string, isActive: boolean) {
    const { error } = await supabase
      .from("knowledge_sources")
      // @ts-expect-error - is_active column added via migration; types regenerate async
      .update({ is_active: isActive })
      .eq("id", sourceId);
    return !error;
  },

  async getActiveSourceCount(): Promise<{ active: number; total: number }> {
    const [activeRes, totalRes] = await Promise.all([
      supabase
        .from("knowledge_sources")
        // @ts-expect-error - is_active column added via migration
        .select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("knowledge_sources").select("id", { count: "exact", head: true }),
    ]);
    return { active: activeRes.count || 0, total: totalRes.count || 0 };
  },

  async getEntries(sourceId?: string) {
    let q = supabase
      .from("knowledge_entries")
      .select("id, source_id, source_person, title, content, category, domain, tags, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (sourceId) q = q.eq("source_id", sourceId);
    const { data, error } = await q;
    if (error) {
      console.error("getEntries error:", error);
      return [];
    }
    return data || [];
  },

  async deleteSource(sourceId: string) {
    // Cascade delete via FK
    await supabase.from("knowledge_entries").delete().eq("source_id", sourceId);
    const { error } = await supabase.from("knowledge_sources").delete().eq("id", sourceId);
    return !error;
  },

  async getReflections() {
    const { data, error } = await supabase
      .from("reflection_notes")
      .select("id, content, note_type, importance, source_ids, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error("getReflections error:", error);
      return [];
    }
    return data || [];
  },

  async getCounts() {
    const [s, e, m] = await Promise.all([
      supabase.from("knowledge_sources").select("id", { count: "exact", head: true }),
      supabase.from("knowledge_entries").select("id", { count: "exact", head: true }),
      supabase.from("wisdom_memories").select("id", { count: "exact", head: true }),
    ]);
    return {
      sources: s.count || 0,
      entries: e.count || 0,
      memories: m.count || 0,
    };
  },
};

// Client-side document parsing helpers
export async function parseFileToText(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
    return await file.text();
  }

  if (name.endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
    const buf = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    let out = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items
        .map((it: unknown) => (it as { str?: string }).str || "")
        .filter(Boolean);
      out += strings.join(" ") + "\n\n";
    }
    return out;
  }

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return result.value || "";
  }

  // Fallback: try plain text read
  return await file.text();
}
