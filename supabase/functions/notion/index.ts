// Notion edge function — proof of registry-driven integration.
// Receives { action, params } envelope from the dispatcher.
// Auth: env-level NOTION_API_KEY (internal integration token from notion.so/my-integrations).

import { corsHeaders } from "@supabase/supabase-js/cors";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function err(status: number, message: string) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function ok(data: unknown) {
  return new Response(JSON.stringify({ success: true, ...(typeof data === "object" && data ? data : { data }) }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function notion(path: string, init: RequestInit = {}, token: string) {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.message || data?.code || `Notion API ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/** Minimal markdown → Notion blocks (paragraphs, h1/h2/h3, bullets). */
function markdownToBlocks(md: string): unknown[] {
  if (!md) return [];
  const lines = md.split(/\r?\n/);
  const blocks: unknown[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const text = (t: string) => [{ type: "text", text: { content: t } }];
    if (line.startsWith("### ")) {
      blocks.push({ object: "block", type: "heading_3", heading_3: { rich_text: text(line.slice(4)) } });
    } else if (line.startsWith("## ")) {
      blocks.push({ object: "block", type: "heading_2", heading_2: { rich_text: text(line.slice(3)) } });
    } else if (line.startsWith("# ")) {
      blocks.push({ object: "block", type: "heading_1", heading_1: { rich_text: text(line.slice(2)) } });
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: text(line.slice(2)) },
      });
    } else {
      blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: text(line) } });
    }
  }
  return blocks;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const token = Deno.env.get("NOTION_API_KEY");
  if (!token) return err(500, "NOTION_API_KEY not configured");

  let body: { action?: string; params?: Record<string, any> } = {};
  try { body = await req.json(); } catch { return err(400, "Invalid JSON body"); }
  const action = body.action;
  const params = body.params ?? {};
  if (!action) return err(400, "Missing 'action'");

  try {
    switch (action) {
      case "search": {
        const payload: Record<string, unknown> = {
          query: String(params.query ?? ""),
          page_size: Math.min(Math.max(Number(params.pageSize) || 25, 1), 100),
        };
        if (params.filter === "page" || params.filter === "database") {
          payload.filter = { value: params.filter, property: "object" };
        }
        const data = await notion("/search", { method: "POST", body: JSON.stringify(payload) }, token);
        return ok({
          results: (data.results ?? []).map((r: any) => ({
            id: r.id,
            object: r.object,
            title:
              r.properties?.title?.title?.[0]?.plain_text ||
              r.properties?.Name?.title?.[0]?.plain_text ||
              r.title?.[0]?.plain_text ||
              "(untitled)",
            url: r.url,
          })),
        });
      }

      case "get_page": {
        if (!params.pageId) return err(400, "pageId required");
        const [page, blocks] = await Promise.all([
          notion(`/pages/${params.pageId}`, {}, token),
          notion(`/blocks/${params.pageId}/children?page_size=100`, {}, token),
        ]);
        return ok({ page, blocks: blocks.results ?? [] });
      }

      case "create_page": {
        if (!params.parentId || !params.title) return err(400, "parentId and title required");
        const parentType = params.parentType === "database" ? "database_id" : "page_id";
        const payload: Record<string, unknown> = {
          parent: { [parentType]: params.parentId },
          properties:
            parentType === "database_id"
              ? { Name: { title: [{ text: { content: String(params.title) } }] } }
              : { title: { title: [{ text: { content: String(params.title) } }] } },
          children: markdownToBlocks(String(params.markdown ?? "")),
        };
        const data = await notion("/pages", { method: "POST", body: JSON.stringify(payload) }, token);
        return ok({ id: data.id, url: data.url });
      }

      case "append_blocks": {
        if (!params.pageId || !params.markdown) return err(400, "pageId and markdown required");
        const blocks = markdownToBlocks(String(params.markdown));
        if (blocks.length === 0) return ok({ appended: 0 });
        const data = await notion(
          `/blocks/${params.pageId}/children`,
          { method: "PATCH", body: JSON.stringify({ children: blocks }) },
          token,
        );
        return ok({ appended: blocks.length, results: data.results });
      }

      case "query_database": {
        if (!params.databaseId) return err(400, "databaseId required");
        const data = await notion(
          `/databases/${params.databaseId}/query`,
          {
            method: "POST",
            body: JSON.stringify({ page_size: Math.min(Math.max(Number(params.pageSize) || 25, 1), 100) }),
          },
          token,
        );
        return ok({
          rows: (data.results ?? []).map((r: any) => ({
            id: r.id,
            url: r.url,
            properties: r.properties,
          })),
        });
      }

      default:
        return err(400, `Unknown action: ${action}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[notion] ${action} failed:`, msg);
    return err(500, msg);
  }
});
