// Research edge function — universal web search/scrape/map/answer.
// Actions: web_search, web_scrape, web_map, web_enrich, web_answer.
// Phase 3: query reformulation + intent routing + freshness scoring + answer synthesis.

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

type Intent = "news" | "factual_lookup" | "deep_research" | "local" | "domain_specific" | "default";

const TAVILY_KEY = Deno.env.get("TAVILY_API_KEY");
const FIRECRAWL_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

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

const STOPWORDS = new Set(["the","a","an","of","to","and","or","is","in","on","for","with","my","me","i","that","this","it","what","whats","find","get","show"]);

// --- Cache (fail-open) ---
const CACHE_TTL_MS: Record<string, number> = {
  web_search: 15 * 60 * 1000,
  web_scrape: 24 * 60 * 60 * 1000,
  web_map:    24 * 60 * 60 * 1000,
  web_answer: 30 * 60 * 1000,
};
const TTL_MIN_MS = 5 * 60 * 1000;
const TTL_MAX_MS = 7 * 24 * 60 * 60 * 1000;

// --- Phase 4: Adaptive learning helpers (all fail-open) ---
function extractDomain(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return null; }
}

function classifyFailure(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("timeout") || m.includes("timed out")) return "provider_timeout";
  if (m.includes("rate") && m.includes("limit")) return "rate_limit";
  if (m.includes("401") || m.includes("403") || m.includes("unauthor") || m.includes("forbidden") || m.includes("api_key") || m.includes("missing")) return "auth";
  if (m.includes("no search providers") || m.includes("zero results") || m.includes("no results")) return "zero_results";
  if (m.includes("query required") || m.includes("url required")) return "bad_query";
  return "other";
}

async function logFailure(userId: string, action: string, intent: string | null, failureClass: string, query: string | null, errorMessage: string, provider?: string): Promise<void> {
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    await admin.from("research_failures").insert({
      user_id: userId, action, intent, failure_class: failureClass,
      provider: provider ?? null, query, error_message: errorMessage.slice(0, 500),
    });
  } catch (e) { console.warn("[research] logFailure failed:", e instanceof Error ? e.message : e); }
}

async function getCacheTtlMs(userId: string, action: string, intent: string): Promise<number> {
  const fallback = CACHE_TTL_MS[action];
  if (!fallback) return 0;
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    const { data } = await admin.from("cache_policy").select("ttl_seconds").eq("user_id", userId).eq("action", action).eq("intent", intent).maybeSingle();
    if (data?.ttl_seconds) return Math.min(Math.max(data.ttl_seconds * 1000, TTL_MIN_MS), TTL_MAX_MS);
  } catch (e) { console.warn("[research] getCacheTtlMs fail-open:", e instanceof Error ? e.message : e); }
  return fallback;
}

async function recordCacheStat(userId: string, action: string, intent: string, hit: boolean): Promise<void> {
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: existing } = await admin.from("cache_policy").select("id, hit_count, miss_count, ttl_seconds").eq("user_id", userId).eq("action", action).eq("intent", intent).maybeSingle();
    if (!existing) {
      await admin.from("cache_policy").insert({
        user_id: userId, action, intent,
        ttl_seconds: Math.floor((CACHE_TTL_MS[action] ?? 900_000) / 1000),
        hit_count: hit ? 1 : 0, miss_count: hit ? 0 : 1,
      });
      return;
    }
    const hits = existing.hit_count + (hit ? 1 : 0);
    const misses = existing.miss_count + (hit ? 0 : 1);
    const total = hits + misses;
    let ttl = existing.ttl_seconds;
    if (total >= 20 && total % 10 === 0) {
      const ratio = hits / total;
      if (ratio > 0.6) ttl = Math.min(Math.floor(ttl * 1.25), 604_800);
      else if (ratio < 0.2) ttl = Math.max(Math.floor(ttl * 0.75), 300);
    }
    await admin.from("cache_policy").update({ hit_count: hits, miss_count: misses, ttl_seconds: ttl, last_tuned_at: new Date().toISOString() }).eq("id", existing.id);
  } catch (e) { console.warn("[research] recordCacheStat fail-open:", e instanceof Error ? e.message : e); }
}

async function getTrustScores(userId: string, domains: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (domains.length === 0) return map;
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    const { data } = await admin.from("source_reputation").select("domain, trust_score").eq("user_id", userId).in("domain", domains);
    for (const row of data ?? []) map.set(row.domain, Number(row.trust_score));
  } catch (e) { console.warn("[research] getTrustScores fail-open:", e instanceof Error ? e.message : e); }
  return map;
}

async function bumpReturned(userId: string, domains: string[]): Promise<void> {
  if (domains.length === 0) return;
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    const existing = await admin.from("source_reputation").select("domain, total_returned, total_enriched, total_failed, trust_score").eq("user_id", userId).in("domain", domains);
    const have = new Map((existing.data ?? []).map((r) => [r.domain, r]));
    const upserts = domains.map((d) => {
      const row = have.get(d);
      if (!row) return { user_id: userId, domain: d, total_returned: 1, trust_score: 0.5, last_seen_at: new Date().toISOString() };
      const returned = row.total_returned + 1;
      const enriched = row.total_enriched;
      const failed = row.total_failed;
      const trust = Math.max(0, Math.min(1, 0.5 + (enriched * 0.05) - (failed * 0.1) + Math.log10(returned + 1) * 0.02));
      return { user_id: userId, domain: d, total_returned: returned, trust_score: trust, last_seen_at: new Date().toISOString() };
    });
    await admin.from("source_reputation").upsert(upserts, { onConflict: "user_id,domain" });
  } catch (e) { console.warn("[research] bumpReturned fail-open:", e instanceof Error ? e.message : e); }
}

async function bumpEnriched(userId: string, domain: string, ok: boolean): Promise<void> {
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: row } = await admin.from("source_reputation").select("id, total_returned, total_enriched, total_failed").eq("user_id", userId).eq("domain", domain).maybeSingle();
    if (!row) return;
    const enriched = row.total_enriched + (ok ? 1 : 0);
    const failed = row.total_failed + (ok ? 0 : 1);
    const trust = Math.max(0, Math.min(1, 0.5 + (enriched * 0.05) - (failed * 0.1) + Math.log10((row.total_returned || 1) + 1) * 0.02));
    await admin.from("source_reputation").update({ total_enriched: enriched, total_failed: failed, trust_score: trust }).eq("id", row.id);
  } catch (e) { console.warn("[research] bumpEnriched fail-open:", e instanceof Error ? e.message : e); }
}

async function lookupQueryPattern(userId: string, intent: string, patternHash: string): Promise<string | null> {
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    const { data } = await admin.from("query_patterns").select("rewritten, success_count, use_count").eq("user_id", userId).eq("intent", intent).eq("pattern_hash", patternHash).maybeSingle();
    if (data && data.success_count >= 5) {
      void admin.from("query_patterns").update({ use_count: data.use_count + 1, last_used_at: new Date().toISOString() }).eq("user_id", userId).eq("pattern_hash", patternHash);
      return data.rewritten;
    }
  } catch (e) { console.warn("[research] lookupQueryPattern fail-open:", e instanceof Error ? e.message : e); }
  return null;
}

async function recordPatternResult(userId: string, intent: string, patternHash: string, original: string, rewritten: string, resultCount: number, success: boolean): Promise<void> {
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: row } = await admin.from("query_patterns").select("id, success_count, use_count, avg_result_count").eq("user_id", userId).eq("pattern_hash", patternHash).maybeSingle();
    if (!row) {
      await admin.from("query_patterns").insert({
        user_id: userId, intent, pattern_hash: patternHash,
        original_sample: original.slice(0, 300), rewritten: rewritten.slice(0, 300),
        success_count: success ? 1 : 0, use_count: 1, avg_result_count: resultCount,
      });
      return;
    }
    const useCount = row.use_count + 1;
    const successCount = row.success_count + (success ? 1 : 0);
    const avg = ((Number(row.avg_result_count ?? 0) * row.use_count) + resultCount) / useCount;
    await admin.from("query_patterns").update({
      use_count: useCount, success_count: successCount,
      avg_result_count: avg, last_used_at: new Date().toISOString(),
    }).eq("id", row.id);
  } catch (e) { console.warn("[research] recordPatternResult fail-open:", e instanceof Error ? e.message : e); }
}

function patternHashFor(intent: string, query: string): Promise<string> {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => !STOPWORDS.has(t.replace(/[^\w]/g, ""))).sort().join(" ");
  return sha256Hex(`${intent}::${tokens}`);
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildCacheKey(action: string, params: Record<string, unknown>): Promise<string> {
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

// --- Query intelligence (Lovable AI Gateway, fail-open) ---
const OPERATOR_REGEX = /(\bsite:|"|-\w|\bOR\b|\bAND\b|filetype:)/i;

function isWeakQuery(q: string): boolean {
  if (OPERATOR_REGEX.test(q)) return false;
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const meaningful = tokens.filter((t) => !STOPWORDS.has(t.replace(/[^\w]/g, "")));
  return meaningful.length < 3;
}

async function callGateway(messages: Array<{ role: string; content: string }>, opts?: { jsonMode?: boolean; maxTokens?: number }): Promise<string | null> {
  if (!LOVABLE_API_KEY) return null;
  try {
    const body: Record<string, unknown> = {
      model: "google/gemini-2.5-flash-lite",
      messages,
      max_tokens: opts?.maxTokens ?? 200,
    };
    if (opts?.jsonMode) body.response_format = { type: "json_object" };
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[research] gateway ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.warn("[research] gateway failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function reformulateQuery(query: string, contextHint?: string): Promise<string> {
  if (!isWeakQuery(query)) return query;
  const sys = "Rewrite the user's vague search query into a concise, specific web search string (max 10 words). Use concrete nouns. Output ONLY the rewritten query, no quotes, no explanation.";
  const userMsg = contextHint ? `Context: ${contextHint}\nQuery: ${query}` : `Query: ${query}`;
  const out = await callGateway([{ role: "system", content: sys }, { role: "user", content: userMsg }], { maxTokens: 60 });
  if (!out) return query;
  const cleaned = out.trim().replace(/^["']|["']$/g, "").split("\n")[0].slice(0, 200);
  return cleaned || query;
}

async function classifyIntent(query: string): Promise<Intent> {
  const sys = `Classify the search intent. Respond with ONLY one word from: news, factual_lookup, deep_research, local, domain_specific, default.
- news: current events, recent happenings, "latest", "today"
- factual_lookup: specific fact, definition, quick answer
- deep_research: comprehensive understanding needed, "explain", "compare", "analyze"
- local: location-based, "near me", specific city
- domain_specific: contains site: operator or asks about a specific website
- default: general web search`;
  const out = await callGateway([{ role: "system", content: sys }, { role: "user", content: query }], { maxTokens: 10 });
  if (!out) return "default";
  const word = out.trim().toLowerCase().split(/\s+/)[0].replace(/[^a-z_]/g, "");
  const valid: Intent[] = ["news","factual_lookup","deep_research","local","domain_specific","default"];
  return (valid as string[]).includes(word) ? word as Intent : "default";
}

// --- Provider: Tavily search ---
async function tavilySearch(query: string, maxResults: number, opts: { recencyDays?: number; includeDomains?: string[]; excludeDomains?: string[]; depth?: "basic" | "advanced" } = {}): Promise<NormalizedResult[]> {
  if (!TAVILY_KEY) throw new Error("TAVILY_API_KEY missing");
  const body: Record<string, unknown> = {
    api_key: TAVILY_KEY,
    query,
    search_depth: opts.depth ?? "advanced",
    max_results: Math.min(maxResults, 20),
    include_answer: false,
  };
  if (opts.recencyDays) body.days = opts.recencyDays;
  if (opts.includeDomains?.length) body.include_domains = opts.includeDomains;
  if (opts.excludeDomains?.length) body.exclude_domains = opts.excludeDomains;

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
    headers: { "Authorization": `Bearer ${FIRECRAWL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: Math.min(maxResults, 20) }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Firecrawl search ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
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

// --- Merge + dedupe + freshness-aware rank ---
function freshnessBoost(publishedAt: string | undefined, recencyDays?: number): number {
  if (!publishedAt) return 0;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return 0;
  const ageDays = (Date.now() - t) / (24 * 60 * 60 * 1000);
  if (ageDays < 0) return 0;
  // Decay: full boost (0.3) at 0 days, ~0 at 30 days (or recencyDays*2)
  const halflife = recencyDays ? recencyDays * 2 : 30;
  return 0.3 * Math.exp(-ageDays / halflife);
}

function mergeResults(lists: NormalizedResult[][], maxResults: number, recencyDays?: number): NormalizedResult[] {
  const map = new Map<string, NormalizedResult>();
  for (const list of lists) {
    for (const r of list) {
      const key = r.url.replace(/\/+$/, "").toLowerCase();
      const adjusted: NormalizedResult = { ...r, score: r.score + freshnessBoost(r.publishedAt, recencyDays) };
      const existing = map.get(key);
      if (!existing || adjusted.score > existing.score) {
        map.set(key, adjusted);
      }
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

// --- Action handlers ---
async function handleWebSearch(params: Record<string, unknown>, userId?: string) {
  const rawQuery = String(params.query ?? "").trim();
  if (!rawQuery) throw new Error("query required");
  const maxResults = Math.min(Number(params.maxResults ?? 10) || 10, 25);
  const contextHint = typeof params.contextHint === "string" ? params.contextHint : undefined;
  const skipIntelligence = params.skipIntelligence === true;

  // Stage 0: query intelligence (fail-open, runs in parallel)
  let intent: Intent = "default";
  let rewrittenQuery = rawQuery;
  let patternHash: string | null = null;
  let patternFromCache = false;
  if (!skipIntelligence) {
    intent = await classifyIntent(rawQuery);
    if (userId) {
      patternHash = await patternHashFor(intent, rawQuery);
      const cached = await lookupQueryPattern(userId, intent, patternHash);
      if (cached) { rewrittenQuery = cached; patternFromCache = true; }
    }
    if (!patternFromCache) {
      rewrittenQuery = await reformulateQuery(rawQuery, contextHint);
    }
  }

  // Resolve strategy from intent (caller params override).
  let recencyDays = params.recencyDays ? Number(params.recencyDays) : undefined;
  const includeDomains = Array.isArray(params.includeDomains) ? params.includeDomains as string[] : undefined;
  const excludeDomains = Array.isArray(params.excludeDomains) ? params.excludeDomains as string[] : undefined;
  let depth: "basic" | "advanced" = "advanced";
  let useFirecrawl = !!FIRECRAWL_KEY;

  if (!params.recencyDays) {
    if (intent === "news") recencyDays = 7;
    else if (intent === "deep_research") recencyDays = undefined;
  }
  if (intent === "news") useFirecrawl = false;
  else if (intent === "factual_lookup") depth = "basic";

  const attempted: string[] = [];
  if (TAVILY_KEY) attempted.push("tavily");
  if (useFirecrawl) attempted.push("firecrawl");
  if (attempted.length === 0) throw new Error("No search providers configured");

  const settled = await Promise.allSettled([
    TAVILY_KEY ? tavilySearch(rewrittenQuery, maxResults, { recencyDays, includeDomains, excludeDomains, depth }) : Promise.reject(new Error("skip")),
    useFirecrawl ? firecrawlSearch(rewrittenQuery, maxResults) : Promise.reject(new Error("skip")),
  ]);

  const succeeded: string[] = [];
  const lists: NormalizedResult[][] = [];
  if (settled[0].status === "fulfilled") { succeeded.push("tavily"); lists.push(settled[0].value); }
  else console.warn("[research] tavily failed:", (settled[0].reason as Error)?.message);
  if (settled[1].status === "fulfilled") { succeeded.push("firecrawl"); lists.push(settled[1].value); }
  else if (useFirecrawl) console.warn("[research] firecrawl failed:", (settled[1].reason as Error)?.message);

  // Trust-aware ranking
  let merged = mergeResults(lists, maxResults * 2, recencyDays);
  if (userId && merged.length > 0) {
    const domains = Array.from(new Set(merged.map((r) => extractDomain(r.url)).filter((d): d is string => !!d)));
    const trustMap = await getTrustScores(userId, domains);
    merged = merged.map((r) => {
      const d = extractDomain(r.url);
      const trust = d ? (trustMap.get(d) ?? 0.5) : 0.5;
      return { ...r, score: r.score + (trust - 0.5) * 0.4 };
    }).sort((a, b) => b.score - a.score).slice(0, maxResults);
    void bumpReturned(userId, domains.slice(0, maxResults));
  } else {
    merged = merged.slice(0, maxResults);
  }

  // Record pattern outcome (only when we actually rewrote the query)
  if (userId && patternHash && !patternFromCache && rewrittenQuery !== rawQuery) {
    void recordPatternResult(userId, intent, patternHash, rawQuery, rewrittenQuery, merged.length, merged.length > 0);
  }

  return {
    results: merged,
    attempted,
    succeeded,
    query: rewrittenQuery,
    intelligence: { original: rawQuery, rewritten: rewrittenQuery, intent, depth, recencyDays, patternFromCache },
  };
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

async function handleWebEnrich(params: Record<string, unknown>, userId: string) {
  const urls = Array.isArray(params.urls) ? (params.urls as unknown[]).filter((u) => typeof u === "string") as string[] : [];
  if (urls.length === 0) throw new Error("urls required");
  const capped = urls.slice(0, 8);
  const results = await Promise.allSettled(
    capped.map(async (url) => {
      const key = await buildCacheKey("web_scrape", { url, onlymaincontent: true });
      const cached = await cacheGet(userId, key);
      if (cached) return cached;
      const fresh = await handleWebScrape({ url, onlyMainContent: true });
      void cacheSet(userId, key, "web_scrape", fresh);
      return fresh;
    }),
  );
  const docs = results
    .map((r, i) => {
      const url = capped[i];
      const domain = extractDomain(url);
      if (r.status === "fulfilled") {
        if (domain) void bumpEnriched(userId, domain, true);
        return r.value;
      }
      if (domain) void bumpEnriched(userId, domain, false);
      return { url, error: (r.reason instanceof Error ? r.reason.message : String(r.reason)) };
    })
    .filter(Boolean);
  return { documents: docs };
}

// --- web_answer: search → enrich top 3 → synthesize with citations ---
async function handleWebAnswer(params: Record<string, unknown>, userId: string) {
  const query = String(params.query ?? "").trim();
  if (!query) throw new Error("query required");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing for synthesis");

  // Stage 1: search
  const search = await handleWebSearch({ query, maxResults: 8, contextHint: params.contextHint });
  const topUrls = search.results.slice(0, 3).map((r) => r.url);

  // Stage 2: enrich top 3
  const enrich = topUrls.length > 0
    ? await handleWebEnrich({ urls: topUrls }, userId)
    : { documents: [] };

  // Stage 3: synthesize
  const docs = enrich.documents as Array<{ url: string; title?: string; markdown?: string; error?: string }>;
  const sourceBlocks = docs
    .filter((d) => !d.error && d.markdown)
    .map((d, i) => `[${i + 1}] ${d.title || d.url}\n${d.url}\n${(d.markdown ?? "").slice(0, 2500)}`)
    .join("\n\n---\n\n");

  const sys = "You answer the user's question using the provided sources. Cite sources inline as [1], [2], etc. Be concise and direct. If sources don't contain the answer, say so.";
  const user = `Question: ${query}\n\nSources:\n${sourceBlocks}`;
  const answer = await callGateway([{ role: "system", content: sys }, { role: "user", content: user }], { maxTokens: 600 }) ?? "Unable to synthesize answer.";

  const citations = docs
    .filter((d) => !d.error)
    .map((d, i) => ({ index: i + 1, url: d.url, title: d.title || d.url }));

  return { answer, citations, query: search.query, intelligence: search.intelligence };
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
  let intelligence: Record<string, unknown> | null = null;

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

    // --- Cache lookup ---
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
          Array.isArray(payload.citations) ? payload.citations.length :
          payload.markdown || payload.answer ? 1 : 0;
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
      intelligence = r.intelligence;
      result = { results: r.results, intelligence: r.intelligence };
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
    } else if (action === "web_answer") {
      attempted = ["tavily", "firecrawl", "gateway"];
      const r = await handleWebAnswer(params, userId);
      succeeded = attempted;
      resultCount = (r.citations as unknown[]).length;
      intelligence = r.intelligence as Record<string, unknown>;
      result = r;
    } else {
      return jsonResp({ success: false, error: `Unknown action: ${action}` }, 400);
    }

    if (cacheKey && CACHE_TTL_MS[action]) {
      void cacheSet(userId, cacheKey, action, result);
    }

    success = true;
    const latency = Date.now() - t0;
    void logRun({
      user_id: userId, query, action,
      providers_attempted: attempted, providers_succeeded: succeeded,
      result_count: resultCount, latency_ms: latency, success: true,
      metadata: { cache: cacheHit ? "hit" : "miss", intelligence: intelligence ?? undefined },
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
      metadata: intelligence ? { intelligence } : undefined,
    });
    return jsonResp({ success: false, error: msg }, 500);
  }
});
