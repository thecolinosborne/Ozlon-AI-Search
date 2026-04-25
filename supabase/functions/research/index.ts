// Research edge function — universal web search/scrape/map.
// Actions: web_search (Tavily + Firecrawl parallel), web_scrape, web_map.
// Returns a normalized envelope: { success, action, results | url+markdown | links }.
// Logs every call to public.research_runs for observability.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface NormalizedResult {
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string;
  score: number;
  source: "tavily" | "firecrawl";
}

const TAVILY_KEY = Deno.env.get("TAVILY_API_KEY");
const FIRECRAWL_KEY = Deno.env.get("FIRECRAWL_API_KEY");

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function logRun(row: {
  user_id: string;
  query: string | null;
  action: string;
  providers_attempted: string[];
  providers_succeeded: string[];
  result_count: number;
  latency_ms: number;
  success: boolean;
  error_class?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    await admin.from("research_runs").insert(row);
  } catch (e) {
    console.warn("[research] logRun failed:", e instanceof Error ? e.message : e);
  }
}

// --- Cache (fail-open) ---
const CACHE_TTL_MS: Record<string, number> = {
  web_search: 15 * 60 * 1000,        // 15 min
  web_scrape: 24 * 60 * 60 * 1000,   // 24 h
  web_map:    24 * 60 * 60 * 1000,   // 24 h
  // web_enrich is just a batch of web_scrape — uses scrape cache per URL.
};

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildCacheKey(action: string, params: Record<string, unknown>): Promise<string> {
  // Stable serialization: sort keys, lowercase, drop undefined.
  const norm: Record<string, unknown> = {};
  Object.keys(params).sort().forEach((k) => {
    const v = params[k];
    if (v === undefined || v === null || v === "") return;
    norm[k] = typeof v === "string" ? v.trim().toLowerCase() : v;
  });
  return sha256Hex(`${action}::${JSON.stringify(norm)}`);
}

async function cacheGet(userId: string, key: string): Promise<unknown | null> {
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    const { data } = await admin
      .from("research_cache")
      .select("payload, expires_at")
      .eq("user_id", userId)
      .eq("cache_key", key)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    return data?.payload ?? null;
  } catch (e) {
    console.warn("[research] cacheGet failed (fail-open):", e instanceof Error ? e.message : e);
    return null;
  }
}

async function cacheSet(userId: string, key: string, action: string, payload: unknown): Promise<void> {
  try {
    const ttl = CACHE_TTL_MS[action];
    if (!ttl) return;
    const admin = createClient(supabaseUrl, serviceKey);
    await admin.from("research_cache").upsert({
      user_id: userId,
      cache_key: key,
      action,
      payload: payload as Record<string, unknown>,
      expires_at: new Date(Date.now() + ttl).toISOString(),
    }, { onConflict: "user_id,cache_key" });
  } catch (e) {
    console.warn("[research] cacheSet failed (fail-open):", e instanceof Error ? e.message : e);
  }
}

// --- Provider: Tavily search ---
async function tavilySearch(query: string, maxResults: number, recencyDays?: number, includeDomains?: string[], excludeDomains?: string[]): Promise<NormalizedResult[]> {
  if (!TAVILY_KEY) throw new Error("TAVILY_API_KEY missing");
  const body: Record<string, unknown> = {
    api_key: TAVILY_KEY,
    query,
    search_depth: "advanced",
    max_results: Math.min(maxResults, 20),
    include_answer: false,
  };
  if (recencyDays) body.days = recencyDays;
  if (includeDomains?.length) body.include_domains = includeDomains;
  if (excludeDomains?.length) body.exclude_domains = excludeDomains;

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Tavily ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map((r: Record<string, unknown>): NormalizedResult => ({
    url: String(r.url ?? ""),
    title: String(r.title ?? ""),
    snippet: String(r.content ?? ""),
    publishedAt: typeof r.published_date === "string" ? r.published_date : undefined,
    score: typeof r.score === "number" ? r.score : 0.5,
    source: "tavily",
  })).filter((r: NormalizedResult) => r.url);
}

// --- Provider: Firecrawl search ---
async function firecrawlSearch(query: string, maxResults: number): Promise<NormalizedResult[]> {
  if (!FIRECRAWL_KEY) throw new Error("FIRECRAWL_API_KEY missing");
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${FIRECRAWL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, limit: Math.min(maxResults, 20) }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Firecrawl search ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  // v2 may return { data: { web: [...] } } or { data: [...] }
  const raw = (data?.data?.web ?? data?.data ?? data?.web ?? []) as Array<Record<string, unknown>>;
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((r): NormalizedResult => {
    const meta = (r.metadata && typeof r.metadata === "object") ? r.metadata as Record<string, unknown> : {};
    const title = (typeof r.title === "string" && r.title) || (typeof meta.title === "string" ? meta.title : "");
    return {
      url: String(r.url ?? ""),
      title: String(title),
      snippet: String(r.description ?? r.snippet ?? ""),
      publishedAt: undefined,
      score: 0.5,
      source: "firecrawl",
    };
  }).filter((r) => r.url);
}

// --- Merge + dedupe + rank ---
function mergeResults(lists: NormalizedResult[][], maxResults: number): NormalizedResult[] {
  const map = new Map<string, NormalizedResult>();
  for (const list of lists) {
    for (const r of list) {
      const key = r.url.replace(/\/+$/, "").toLowerCase();
      const existing = map.get(key);
      if (!existing || r.score > existing.score) {
        map.set(key, r);
      }
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

// --- Action handlers ---
async function handleWebSearch(params: Record<string, unknown>) {
  const query = String(params.query ?? "").trim();
  if (!query) throw new Error("query required");
  const maxResults = Math.min(Number(params.maxResults ?? 10) || 10, 25);
  const recencyDays = params.recencyDays ? Number(params.recencyDays) : undefined;
  const includeDomains = Array.isArray(params.includeDomains) ? params.includeDomains as string[] : undefined;
  const excludeDomains = Array.isArray(params.excludeDomains) ? params.excludeDomains as string[] : undefined;

  const attempted: string[] = [];
  if (TAVILY_KEY) attempted.push("tavily");
  if (FIRECRAWL_KEY) attempted.push("firecrawl");
  if (attempted.length === 0) throw new Error("No search providers configured");

  const settled = await Promise.allSettled([
    TAVILY_KEY ? tavilySearch(query, maxResults, recencyDays, includeDomains, excludeDomains) : Promise.reject(new Error("skip")),
    FIRECRAWL_KEY ? firecrawlSearch(query, maxResults) : Promise.reject(new Error("skip")),
  ]);

  const succeeded: string[] = [];
  const lists: NormalizedResult[][] = [];
  if (settled[0].status === "fulfilled") { succeeded.push("tavily"); lists.push(settled[0].value); }
  else console.warn("[research] tavily failed:", settled[0].reason?.message);
  if (settled[1].status === "fulfilled") { succeeded.push("firecrawl"); lists.push(settled[1].value); }
  else console.warn("[research] firecrawl failed:", settled[1].reason?.message);

  const merged = mergeResults(lists, maxResults);
  return { results: merged, attempted, succeeded, query };
}

async function handleWebScrape(params: Record<string, unknown>) {
  if (!FIRECRAWL_KEY) throw new Error("FIRECRAWL_API_KEY missing");
  const url = String(params.url ?? "").trim();
  if (!url) throw new Error("url required");
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Authorization": `Bearer ${FIRECRAWL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: params.onlyMainContent !== false,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Firecrawl scrape ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const doc = data?.data ?? data;
  return {
    url,
    title: doc?.metadata?.title ?? "",
    markdown: (doc?.markdown ?? "").slice(0, 8000),
  };
}

async function handleWebMap(params: Record<string, unknown>) {
  if (!FIRECRAWL_KEY) throw new Error("FIRECRAWL_API_KEY missing");
  const url = String(params.url ?? "").trim();
  if (!url) throw new Error("url required");
  const res = await fetch("https://api.firecrawl.dev/v2/map", {
    method: "POST",
    headers: { "Authorization": `Bearer ${FIRECRAWL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      search: params.search,
      limit: Math.min(Number(params.limit ?? 100) || 100, 500),
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Firecrawl map ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const links = (data?.data?.links ?? data?.links ?? []) as Array<string | { url: string }>;
  const normalized = links.map((l) => typeof l === "string" ? { url: l } : l).filter((l) => l?.url);
  return { url, links: normalized };
}

// --- web_enrich: batched parallel scrape of N urls (stage 2 of two-stage flow) ---
async function handleWebEnrich(params: Record<string, unknown>, userId: string) {
  const urls = Array.isArray(params.urls) ? (params.urls as unknown[]).filter((u) => typeof u === "string") as string[] : [];
  if (urls.length === 0) throw new Error("urls required");
  const capped = urls.slice(0, 8);
  const results = await Promise.allSettled(
    capped.map(async (url) => {
      // Reuse scrape cache per-url.
      const key = await buildCacheKey("web_scrape", { url, onlymaincontent: true });
      const cached = await cacheGet(userId, key);
      if (cached) return cached;
      const fresh = await handleWebScrape({ url, onlyMainContent: true });
      void cacheSet(userId, key, "web_scrape", fresh);
      return fresh;
    }),
  );
  const docs = results
    .map((r, i) => r.status === "fulfilled" ? r.value : { url: capped[i], error: (r.reason instanceof Error ? r.reason.message : String(r.reason)) })
    .filter(Boolean);
  return { documents: docs };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const t0 = Date.now();
  let action = "unknown";
  let userId = "anonymous";
  let query: string | null = null;
  let attempted: string[] = [];
  let succeeded: string[] = [];
  let resultCount = 0;
  let success = false;
  let errorClass: string | null = null;
  let cacheHit = false;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResp({ success: false, error: "Unauthorized" }, 401);
    }
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    // deno-lint-ignore no-explicit-any
    const { data: claims } = await (supabase.auth as any).getClaims(token);
    if (!claims?.claims?.sub) {
      return jsonResp({ success: false, error: "Unauthorized" }, 401);
    }
    userId = claims.claims.sub;

    const body = await req.json().catch(() => ({}));
    action = String(body?.action ?? "");
    const params = (body?.params ?? {}) as Record<string, unknown>;
    query = typeof params.query === "string" ? params.query : (typeof params.url === "string" ? params.url : null);

    // --- Cache lookup (cacheable single-call actions only) ---
    let cacheKey: string | null = null;
    if (CACHE_TTL_MS[action]) {
      cacheKey = await buildCacheKey(action, params);
      const cached = await cacheGet(userId, cacheKey);
      if (cached && typeof cached === "object") {
        cacheHit = true;
        const latency = Date.now() - t0;
        const payload = cached as Record<string, unknown>;
        const count =
          Array.isArray(payload.results) ? payload.results.length :
          Array.isArray(payload.links) ? payload.links.length :
          payload.markdown ? 1 : 0;
        void logRun({
          user_id: userId, query, action,
          providers_attempted: ["cache"], providers_succeeded: ["cache"],
          result_count: count, latency_ms: latency, success: true,
          metadata: { cache: "hit" },
        });
        return jsonResp({ success: true, action, cache: "hit", ...payload });
      }
    }

    let result: Record<string, unknown>;
    if (action === "web_search") {
      const r = await handleWebSearch(params);
      attempted = r.attempted;
      succeeded = r.succeeded;
      resultCount = r.results.length;
      result = { results: r.results };
    } else if (action === "web_scrape") {
      attempted = ["firecrawl"];
      const r = await handleWebScrape(params);
      succeeded = ["firecrawl"];
      resultCount = r.markdown ? 1 : 0;
      result = r;
    } else if (action === "web_map") {
      attempted = ["firecrawl"];
      const r = await handleWebMap(params);
      succeeded = ["firecrawl"];
      resultCount = (r.links as unknown[]).length;
      result = r;
    } else if (action === "web_enrich") {
      attempted = ["firecrawl"];
      const r = await handleWebEnrich(params, userId);
      succeeded = ["firecrawl"];
      resultCount = (r.documents as unknown[]).length;
      result = r;
    } else {
      return jsonResp({ success: false, error: `Unknown action: ${action}` }, 400);
    }

    // Cache write (best-effort)
    if (cacheKey && CACHE_TTL_MS[action]) {
      void cacheSet(userId, cacheKey, action, result);
    }

    success = true;
    const latency = Date.now() - t0;
    void logRun({
      user_id: userId, query, action,
      providers_attempted: attempted, providers_succeeded: succeeded,
      result_count: resultCount, latency_ms: latency, success: true,
      metadata: { cache: cacheHit ? "hit" : "miss" },
    });
    return jsonResp({ success: true, action, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errorClass = msg.split(":")[0].slice(0, 80);
    console.error(`[research] ${action} failed:`, msg);
    const latency = Date.now() - t0;
    void logRun({
      user_id: userId, query, action,
      providers_attempted: attempted, providers_succeeded: succeeded,
      result_count: resultCount, latency_ms: latency, success: false, error_class: errorClass,
    });
    return jsonResp({ success: false, error: msg }, 500);
  }
});
