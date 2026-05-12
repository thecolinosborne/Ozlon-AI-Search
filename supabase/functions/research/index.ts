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

async function cacheSet(userId: string, key: string, action: string, payload: unknown, ttlMsOverride?: number): Promise<void> {
  try {
    const ttl = ttlMsOverride ?? CACHE_TTL_MS[action];
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

// --- Phase 6: Embeddings + recall helpers (all fail-open) ---
async function embedText(text: string): Promise<number[] | null> {
  if (!LOVABLE_API_KEY) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "openai/text-embedding-3-small", input: text.slice(0, 4000) }),
    });
    if (!res.ok) { console.warn(`[research] embed ${res.status}`); return null; }
    const data = await res.json();
    const vec = data?.data?.[0]?.embedding;
    return Array.isArray(vec) ? vec : null;
  } catch (e) {
    console.warn("[research] embed failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function findSimilarPlans(userId: string, question: string, threshold = 0.82, maxAgeHours = 168): Promise<Array<{ id: string; original_question: string; final_answer: string; confidence: number; gaps_detected: string[]; sub_queries: unknown; created_at: string; similarity: number }>> {
  try {
    const emb = await embedText(question);
    if (!emb) return [];
    const admin = createClient(supabaseUrl, serviceKey);
    const { data, error } = await admin.rpc("match_research_plans", {
      query_embedding: emb as unknown as string,
      match_threshold: threshold,
      match_count: 5,
      filter_user_id: userId,
      max_age_hours: maxAgeHours,
    });
    if (error) { console.warn("[research] match_research_plans:", error.message); return []; }
    return (data ?? []) as Array<{ id: string; original_question: string; final_answer: string; confidence: number; gaps_detected: string[]; sub_queries: unknown; created_at: string; similarity: number }>;
  } catch (e) {
    console.warn("[research] findSimilarPlans failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

async function handleWebRecall(params: Record<string, unknown>, userId: string): Promise<Record<string, unknown>> {
  const question = String(params.query ?? "").trim();
  if (!question) throw new Error("query required");
  const maxAgeHours = typeof params.maxAgeHours === "number" ? Math.min(720, Math.max(1, params.maxAgeHours)) : 168;
  const threshold = typeof params.threshold === "number" ? Math.min(0.99, Math.max(0.5, params.threshold)) : 0.82;

  const matches = await findSimilarPlans(userId, question, threshold, maxAgeHours);
  return {
    query: question,
    matches: matches.map((m) => ({
      plan_id: m.id,
      original_question: m.original_question,
      answer: m.final_answer,
      confidence: m.confidence,
      gaps: m.gaps_detected ?? [],
      similarity: m.similarity,
      age_hours: Math.round((Date.now() - new Date(m.created_at).getTime()) / 3_600_000),
      sub_queries: m.sub_queries,
    })),
  };
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
  const search = await handleWebSearch({ query, maxResults: 8, contextHint: params.contextHint }, userId);
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

// --- Phase 5: Multi-hop investigate ---
const INVESTIGATE_LIMITS = {
  maxSubQueries: 5,
  maxEnrichesTotal: 8,
  wallClockMs: 30_000,
  dailyPlansPerUser: 50,
};

interface SubQueryPlan {
  query: string;
  intent: Intent;
  rationale?: string;
}

async function planInvestigation(question: string, contextHint?: string): Promise<SubQueryPlan[]> {
  const sys = `You decompose research questions into 2-5 focused sub-queries. Output JSON only: {"sub_queries":[{"query":"...","intent":"news|factual_lookup|deep_research|local|domain_specific|default","rationale":"short"}]}. Each sub-query must be independently searchable. Keep them tight.`;
  const userMsg = contextHint
    ? `Context: ${contextHint}\n\nQuestion: ${question}`
    : `Question: ${question}`;
  const raw = await callGateway(
    [{ role: "system", content: sys }, { role: "user", content: userMsg }],
    { jsonMode: true, maxTokens: 500 },
  );
  if (!raw) return [{ query: question, intent: "default" }];
  try {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed?.sub_queries) ? parsed.sub_queries : [];
    const cleaned: SubQueryPlan[] = arr
      .filter((s: unknown) => s && typeof s === "object" && typeof (s as { query?: unknown }).query === "string")
      .slice(0, INVESTIGATE_LIMITS.maxSubQueries)
      .map((s: { query: string; intent?: string; rationale?: string }) => ({
        query: s.query,
        intent: (["news","factual_lookup","deep_research","local","domain_specific","default"] as const).includes(s.intent as Intent) ? s.intent as Intent : "default",
        rationale: s.rationale,
      }));
    return cleaned.length > 0 ? cleaned : [{ query: question, intent: "default" }];
  } catch {
    return [{ query: question, intent: "default" }];
  }
}

async function critiqueAnswer(question: string, answer: string): Promise<{ gaps: string[]; followUp: string | null }> {
  const sys = `You audit a draft answer for completeness against the original question. Output JSON only: {"gaps":["..."],"follow_up":"single targeted query or null"}. Be strict but concise.`;
  const userMsg = `Question: ${question}\n\nDraft answer: ${answer}`;
  const raw = await callGateway(
    [{ role: "system", content: sys }, { role: "user", content: userMsg }],
    { jsonMode: true, maxTokens: 300 },
  );
  if (!raw) return { gaps: [], followUp: null };
  try {
    const parsed = JSON.parse(raw);
    const gaps = Array.isArray(parsed?.gaps) ? parsed.gaps.filter((g: unknown) => typeof g === "string").slice(0, 5) : [];
    const followUp = typeof parsed?.follow_up === "string" && parsed.follow_up.trim().length > 0 ? parsed.follow_up : null;
    return { gaps, followUp };
  } catch {
    return { gaps: [], followUp: null };
  }
}

async function checkPlanBudget(userId: string): Promise<boolean> {
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("research_plans")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", since);
    return (count ?? 0) < INVESTIGATE_LIMITS.dailyPlansPerUser;
  } catch { return true; }
}

async function recordPlan(row: Record<string, unknown>): Promise<string | null> {
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    // Embed the original question for future recall (fail-open)
    const question = typeof row.original_question === "string" ? row.original_question : null;
    const embedding = question ? await embedText(question) : null;
    const insertRow = embedding ? { ...row, original_question_embedding: embedding } : row;
    const { data } = await admin.from("research_plans").insert(insertRow).select("id").single();
    return data?.id ?? null;
  } catch (e) {
    console.warn("[research] recordPlan failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

type EmitFn = (event: string, payload: Record<string, unknown>) => void;
const NOOP_EMIT: EmitFn = () => {};

async function runInvestigation(params: Record<string, unknown>, userId: string, emit: EmitFn = NOOP_EMIT): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const question = String(params.query ?? "").trim();
  if (!question) throw new Error("query required");
  const contextHint = typeof params.contextHint === "string" ? params.contextHint : undefined;
  const skipRecall = params.skipRecall === true;

  // Recall: if a near-identical question was investigated recently, return it
  if (!skipRecall) {
    const recall = await findSimilarPlans(userId, question, 0.88, 24);
    if (recall.length > 0) {
      const top = recall[0];
      const ageHours = Math.round((Date.now() - new Date(top.created_at).getTime()) / 3_600_000);
      const recallPayload = { plan_id: top.id, similarity: top.similarity, age_hours: ageHours, original_question: top.original_question };
      emit("recall_hit", recallPayload);
      return {
        answer: top.final_answer,
        citations: [],
        sub_queries: top.sub_queries,
        confidence: Number(top.confidence ?? 0),
        gaps: top.gaps_detected ?? [],
        recall: recallPayload,
        latency_ms: Date.now() - t0,
      };
    }
  }

  const within = await checkPlanBudget(userId);
  if (!within) {
    emit("budget_exceeded", { fallback: "web_answer" });
    const fallback = await handleWebAnswer({ query: question, contextHint }, userId);
    return { ...fallback, plan: { fallback: "daily_budget_exceeded" } };
  }

  const subQueries = await planInvestigation(question, contextHint);
  const intents = subQueries.map((s) => s.intent);
  emit("plan_ready", { sub_queries: subQueries });

  const remainingBudget = () => Math.max(0, INVESTIGATE_LIMITS.wallClockMs - (Date.now() - t0));

  // Execute sub-queries in parallel; emit per-completion
  const searchResults = await Promise.all(subQueries.map(async (sq, index) => {
    try {
      const r = await handleWebSearch({ query: sq.query, maxResults: 5, contextHint }, userId);
      emit("subquery_done", { index, query: sq.query, intent: sq.intent, result_count: r.results.length });
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[investigate] sub-search failed:", msg);
      emit("subquery_done", { index, query: sq.query, intent: sq.intent, result_count: 0, error: msg });
      return { results: [], attempted: [], succeeded: [], intelligence: { intent: sq.intent } };
    }
  }));

  // Collect top URLs (dedup), respect enrich budget
  const seen = new Set<string>();
  const topUrls: string[] = [];
  for (const sr of searchResults) {
    for (const r of sr.results.slice(0, 2)) {
      if (topUrls.length >= INVESTIGATE_LIMITS.maxEnrichesTotal) break;
      if (!seen.has(r.url)) { seen.add(r.url); topUrls.push(r.url); }
    }
    if (topUrls.length >= INVESTIGATE_LIMITS.maxEnrichesTotal) break;
  }

  let docs: Array<{ url: string; title?: string; markdown?: string; error?: string }> = [];
  if (topUrls.length > 0 && remainingBudget() > 5_000) {
    emit("enrich_start", { urls: topUrls });
    try {
      const enriched = await handleWebEnrich({ urls: topUrls }, userId);
      docs = (enriched.documents as typeof docs) ?? [];
      emit("enrich_done", { document_count: docs.filter((d) => !d.error).length });
    } catch (e) {
      console.warn("[investigate] enrich failed:", e instanceof Error ? e.message : e);
      emit("enrich_done", { document_count: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Synthesize
  emit("synthesis_start", {});
  const sourceBlocks = docs
    .filter((d) => !d.error && d.markdown)
    .map((d, i) => `[${i + 1}] ${d.title || d.url}\n${d.url}\n${(d.markdown ?? "").slice(0, 4000)}`)
    .join("\n\n---\n\n");
  const subSummary = subQueries.map((s, i) => `${i + 1}. (${s.intent}) ${s.query}`).join("\n");
  const synthSys = "You synthesize a comprehensive answer to the user's original question using the provided sources and the sub-queries that were run. Cite sources inline as [1], [2], etc. Structure the answer with key findings. Be precise; flag uncertainty.";
  const synthUser = `Original question: ${question}\n\nSub-queries run:\n${subSummary}\n\nSources:\n${sourceBlocks || "(no enriched sources)"}`;
  let answer = (await callGateway([{ role: "system", content: synthSys }, { role: "user", content: synthUser }], { maxTokens: 900 })) ?? "Unable to synthesize answer.";

  // Self-critique (fail-open)
  let gaps: string[] = [];
  let followUpRan: { query: string; resultCount: number } | null = null;
  if (remainingBudget() > 8_000) {
    const critique = await critiqueAnswer(question, answer);
    gaps = critique.gaps;
    emit("critique_done", { gaps, follow_up: critique.followUp });
    if (critique.followUp && remainingBudget() > 5_000 && topUrls.length < INVESTIGATE_LIMITS.maxEnrichesTotal) {
      try {
        const fu = await handleWebSearch({ query: critique.followUp, maxResults: 3, contextHint }, userId);
        followUpRan = { query: critique.followUp, resultCount: fu.results.length };
        const newUrls = fu.results.map((r) => r.url).filter((u) => !seen.has(u)).slice(0, INVESTIGATE_LIMITS.maxEnrichesTotal - topUrls.length);
        if (newUrls.length > 0) {
          emit("follow_up_enriching", { urls: newUrls });
          const moreEnriched = await handleWebEnrich({ urls: newUrls }, userId);
          const moreDocs = (moreEnriched.documents as typeof docs) ?? [];
          docs = [...docs, ...moreDocs];
          const allBlocks = docs
            .filter((d) => !d.error && d.markdown)
            .map((d, i) => `[${i + 1}] ${d.title || d.url}\n${d.url}\n${(d.markdown ?? "").slice(0, 4000)}`)
            .join("\n\n---\n\n");
          answer = (await callGateway(
            [{ role: "system", content: synthSys }, { role: "user", content: `Original question: ${question}\n\nSub-queries (incl. follow-up): ${subSummary}\n${critique.followUp}\n\nSources:\n${allBlocks}` }],
            { maxTokens: 900 },
          )) ?? answer;
        }
      } catch (e) {
        console.warn("[investigate] follow-up failed:", e instanceof Error ? e.message : e);
      }
    }
  }

  const citations = docs
    .filter((d) => !d.error)
    .map((d, i) => ({ index: i + 1, url: d.url, title: d.title || d.url }));

  const totalLatency = Date.now() - t0;
  const confidence = Math.max(0, Math.min(1, 0.5 + 0.1 * citations.length - 0.15 * gaps.length));

  void recordPlan({
    user_id: userId,
    original_question: question,
    sub_queries: subQueries,
    intents,
    total_cost_estimate: subQueries.length * 0.002 + docs.length * 0.001,
    total_latency_ms: totalLatency,
    final_answer: answer,
    confidence,
    gaps_detected: gaps,
    status: "completed",
    metadata: { followUpRan, enrichedCount: docs.length, contextHint: contextHint ?? null },
  });

  return {
    answer,
    citations,
    sub_queries: subQueries,
    confidence,
    gaps,
    follow_up: followUpRan,
    latency_ms: totalLatency,
  };
}

async function handleWebInvestigate(params: Record<string, unknown>, userId: string): Promise<Record<string, unknown>> {
  return await runInvestigation(params, userId, NOOP_EMIT);
}

// ============================================================
// PERSONAL RESEARCH — fuses web_investigate with the user's
// Wisdom Engine memories to produce a cited, decision-grade
// brief. Persists to research_reports + research_sources.
// ============================================================
async function embedQuery(text: string): Promise<number[] | null> {
  if (!LOVABLE_API_KEY) return null;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "google/gemini-embedding-001", input: text.slice(0, 4000) }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const v = j?.data?.[0]?.embedding;
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}

interface WisdomMatch {
  id: string;
  memory_type: string;
  content: string;
  summary: string | null;
  similarity: number;
}

async function fetchWisdomContext(query: string, userId: string): Promise<WisdomMatch[]> {
  try {
    const emb = await embedQuery(query);
    if (!emb) return [];
    const admin = createClient(supabaseUrl, serviceKey);
    const { data, error } = await admin.rpc("match_wisdom_memories", {
      query_embedding: emb,
      match_threshold: 0.65,
      match_count: 5,
      filter_user_id: userId,
      filter_memory_type: null,
    });
    if (error) {
      console.warn("[personal_research] wisdom rpc error:", error.message);
      return [];
    }
    return (data ?? []) as WisdomMatch[];
  } catch (e) {
    console.warn("[personal_research] wisdom failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

async function synthesizePersonalAnswer(args: {
  query: string;
  webAnswer: string;
  webCitations: Array<{ index: number; url: string; title: string }>;
  wisdom: WisdomMatch[];
  systemName: string;
}): Promise<{ answer: string; followUps: string[]; personalContext: string[] }> {
  if (!LOVABLE_API_KEY) {
    return { answer: args.webAnswer, followUps: [], personalContext: [] };
  }
  const wisdomBlock = args.wisdom.length
    ? args.wisdom.map((w, i) => `[W${i + 1}] (${w.memory_type}, ${(w.similarity * 100).toFixed(0)}% match) ${w.summary ?? w.content.slice(0, 240)}`).join("\n")
    : "(no relevant personal memories)";
  const sys = `You are ${args.systemName || "Ozlon"}, a calm decision-grade research synthesizer. Fuse the web findings with the user's personal memories into a single, decisive brief. Rules: lead with the conclusion in 1-2 sentences. Use inline [1][2] citations from the web sources. When personal memory is relevant, cite as [W1][W2] and add a one-line "from your memory" callout. Plain-speak, ~14-word sentences, no emojis, no jargon. End with a short Recommendation line.`;
  const user = `Question: ${args.query}\n\n=== WEB FINDINGS (cite as [n]) ===\n${args.webAnswer}\n\n=== YOUR PERSONAL MEMORY (cite as [Wn]) ===\n${wisdomBlock}\n\nReturn a JSON object with keys: answer (markdown string with citations), followUps (array of 3 short follow-up questions), personalContext (array of 1-3 short strings naming which personal memories influenced the answer, or empty array).`;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) {
      console.warn("[personal_research] synth http", r.status);
      return { answer: args.webAnswer, followUps: [], personalContext: [] };
    }
    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    return {
      answer: typeof parsed.answer === "string" ? parsed.answer : args.webAnswer,
      followUps: Array.isArray(parsed.followUps) ? parsed.followUps.slice(0, 5).map((s: unknown) => String(s)) : [],
      personalContext: Array.isArray(parsed.personalContext) ? parsed.personalContext.slice(0, 5).map((s: unknown) => String(s)) : [],
    };
  } catch (e) {
    console.warn("[personal_research] synth failed:", e instanceof Error ? e.message : e);
    return { answer: args.webAnswer, followUps: [], personalContext: [] };
  }
}

async function persistResearchReport(args: {
  userId: string;
  conversationId: string | null;
  messageId: string | null;
  query: string;
  answer: string;
  webCitations: Array<{ index: number; url: string; title: string }>;
  wisdom: WisdomMatch[];
  followUps: string[];
  personalContext: string[];
  confidence: number;
  saveAsThread: boolean;
}): Promise<string | null> {
  try {
    const admin = createClient(supabaseUrl, serviceKey);
    const queryEmbedding = await embedQuery(args.query);
    const { data: report, error } = await admin
      .from("research_reports")
      .insert({
        user_id: args.userId,
        conversation_id: args.conversationId,
        message_id: args.messageId,
        query: args.query,
        answer: args.answer,
        mode: "personal",
        confidence: args.confidence,
        follow_ups: args.followUps,
        personal_context: args.personalContext,
        is_living_thread: args.saveAsThread,
        last_refreshed_at: new Date().toISOString(),
        embedding: queryEmbedding,
      })
      .select("id")
      .maybeSingle();
    if (error || !report) {
      console.warn("[personal_research] persist failed:", error?.message);
      return null;
    }
    const reportId = report.id as string;
    const sourceRows = [
      ...args.webCitations.map((c) => ({
        report_id: reportId,
        user_id: args.userId,
        source_type: "web",
        url: c.url,
        title: c.title,
        citation_index: c.index,
      })),
      ...args.wisdom.map((w, i) => ({
        report_id: reportId,
        user_id: args.userId,
        source_type: "wisdom",
        title: w.summary ?? w.content.slice(0, 80),
        snippet: w.content.slice(0, 400),
        citation_index: i + 1,
        relevance_score: Number(w.similarity.toFixed(2)),
        reference_id: w.id,
        metadata: { memory_type: w.memory_type },
      })),
    ];
    if (sourceRows.length > 0) {
      await admin.from("research_sources").insert(sourceRows);
    }
    return reportId;
  } catch (e) {
    console.warn("[personal_research] persist exception:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function handlePersonalResearch(params: Record<string, unknown>, userId: string): Promise<Record<string, unknown>> {
  const query = String(params.query ?? "").trim();
  if (!query) throw new Error("query required");
  const conversationId = typeof params.conversationId === "string" ? params.conversationId : null;
  const messageId = typeof params.messageId === "string" ? params.messageId : null;
  const systemName = typeof params.systemName === "string" ? params.systemName : "Ozlon";
  const saveAsThread = params.saveAsThread === true;

  // Fan out: web investigation + Wisdom retrieval in parallel
  const [webResult, wisdom] = await Promise.all([
    runInvestigation({ query, contextHint: params.contextHint }, userId, NOOP_EMIT).catch((e) => {
      console.warn("[personal_research] web layer failed:", e instanceof Error ? e.message : e);
      return { answer: "Web research unavailable.", citations: [], confidence: 0.3 } as Record<string, unknown>;
    }),
    fetchWisdomContext(query, userId),
  ]);

  const webAnswer = String((webResult as Record<string, unknown>).answer ?? "");
  const webCitations = ((webResult as Record<string, unknown>).citations ?? []) as Array<{ index: number; url: string; title: string }>;
  const baseConfidence = Number((webResult as Record<string, unknown>).confidence ?? 0.6);

  const synth = await synthesizePersonalAnswer({
    query, webAnswer, webCitations, wisdom, systemName,
  });

  // Boost confidence when we have strong personal context
  const personalLift = Math.min(0.15, wisdom.length * 0.03);
  const confidence = Math.max(0, Math.min(1, baseConfidence + personalLift));

  const reportId = await persistResearchReport({
    userId, conversationId, messageId, query,
    answer: synth.answer,
    webCitations, wisdom,
    followUps: synth.followUps,
    personalContext: synth.personalContext,
    confidence, saveAsThread,
  });

  return {
    reportId,
    query,
    answer: synth.answer,
    confidence,
    sources: [
      ...webCitations.map((c) => ({ source_type: "web", index: c.index, url: c.url, title: c.title })),
      ...wisdom.map((w, i) => ({
        source_type: "wisdom",
        index: i + 1,
        title: w.summary ?? w.content.slice(0, 80),
        snippet: w.content.slice(0, 240),
        memory_type: w.memory_type,
        similarity: w.similarity,
      })),
    ],
    personalContext: synth.personalContext,
    followUps: synth.followUps,
  };
}

function streamInvestigation(params: Record<string, unknown>, userId: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let eventCount = 0;
      const send = (event: string, payload: Record<string, unknown>) => {
        try {
          eventCount++;
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch (e) {
          console.warn("[investigate-stream] enqueue failed:", e instanceof Error ? e.message : e);
        }
      };
      // Heartbeat every 10s to keep proxies alive
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: ping\n\n`)); } catch { /* ignore */ }
      }, 10_000);
      try {
        send("started", { query: String(params.query ?? "") });
        const result = await runInvestigation(params, userId, send);
        send("done", { ...result, stream_events: eventCount });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        send("error", { error: msg, failure_class: classifyFailure(msg) });
      } finally {
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* ignore */ }
      }
    },
  });
  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
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
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return jsonResp({ success: false, error: "Unauthorized" }, 401);
    }
    userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    action = String(body?.action ?? "");
    const params = (body?.params ?? {}) as Record<string, unknown>;
    query = typeof params.query === "string" ? params.query : (typeof params.url === "string" ? params.url : null);

    // --- Streaming action: bypass cache + telemetry wrapper, return SSE directly ---
    if (action === "web_investigate_stream") {
      void logRun({
        user_id: userId, query, action,
        providers_attempted: ["planner", "tavily", "firecrawl", "gateway"],
        providers_succeeded: [],
        result_count: 0, latency_ms: 0, success: true,
        metadata: { streamed: true },
      });
      return streamInvestigation(params, userId);
    }

    // --- Cache lookup ---
    let cacheKey: string | null = null;
    if (CACHE_TTL_MS[action]) {
      cacheKey = await buildCacheKey(action, params);
      const cached = await cacheGet(userId, cacheKey);
      if (cached && typeof cached === "object") {
        cacheHit = true;
        const latency = Date.now() - t0;
        const payload = cached as Record<string, unknown>;
        const cachedIntel = (payload.intelligence as Record<string, unknown> | undefined);
        const cachedIntent = typeof cachedIntel?.intent === "string" ? cachedIntel.intent as string : "default";
        void recordCacheStat(userId, action, cachedIntent, true);
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
      const r = await handleWebSearch(params, userId);
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
    } else if (action === "web_investigate") {
      attempted = ["planner", "tavily", "firecrawl", "gateway"];
      const r = await handleWebInvestigate(params, userId);
      succeeded = attempted;
      resultCount = (r.citations as unknown[]).length;
      result = r;
    } else if (action === "web_recall") {
      attempted = ["embedding", "supabase"];
      const r = await handleWebRecall(params, userId);
      succeeded = attempted;
      resultCount = (r.matches as unknown[]).length;
      result = r;
    } else {
      return jsonResp({ success: false, error: `Unknown action: ${action}` }, 400);
    }

    const intentForCache = (intelligence?.intent as string) ?? "default";
    if (cacheKey && CACHE_TTL_MS[action]) {
      const dynTtl = await getCacheTtlMs(userId, action, intentForCache);
      void cacheSet(userId, cacheKey, action, result, dynTtl);
      void recordCacheStat(userId, action, intentForCache, false);
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
    const failClass = classifyFailure(msg);
    const intentForFail = typeof intelligence?.intent === "string" ? intelligence.intent as string : null;
    void logFailure(userId, action, intentForFail, failClass, query, msg);
    void logRun({
      user_id: userId, query, action,
      providers_attempted: attempted, providers_succeeded: succeeded,
      result_count: resultCount, latency_ms: latency, success: false, error_class: errorClass,
      metadata: intelligence ? { intelligence } : undefined,
    });
    return jsonResp({ success: false, error: msg }, 500);
  }
});
