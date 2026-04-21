import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SEARCH_ATLAS_BASE = "https://api.searchatlas.com";

// Auth schemes to probe in order on first failed call. The winning scheme is
// cached per-request via authSchemeCache so subsequent calls skip the probe.
type AuthScheme = "token" | "bearer" | "query";
const AUTH_SCHEMES: AuthScheme[] = ["token", "bearer", "query"];
let cachedScheme: AuthScheme | null = null;

function buildAuthRequest(apiKey: string, url: string, scheme: AuthScheme, init: RequestInit) {
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) || {}),
  };
  let finalUrl = url;
  if (scheme === "token") headers["Authorization"] = `Token ${apiKey}`;
  else if (scheme === "bearer") headers["Authorization"] = `Bearer ${apiKey}`;
  else if (scheme === "query") {
    const sep = url.includes("?") ? "&" : "?";
    finalUrl = `${url}${sep}user_token=${encodeURIComponent(apiKey)}`;
  }
  return { finalUrl, headers };
}

function sanitizeDetail(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.startsWith("<")) {
    return "Search Atlas returned an HTML error page — endpoint path is wrong or token has no access.";
  }
  return trimmed.slice(0, 400);
}

// ============================================================================
// AUTH RESOLUTION (vault → metadata → env fallback)
// ============================================================================

async function tryVaultRead(
  adminClient: ReturnType<typeof createClient>,
  connectionId: string,
  userId: string,
): Promise<string | null> {
  try {
    const vaultKey = Deno.env.get("VAULT_ENCRYPTION_KEY");
    if (!vaultKey) return null;
    const keyBytes = new TextEncoder().encode(vaultKey);
    if (keyBytes.length !== 32) return null;
    const hexKey =
      "\\x" + Array.from(keyBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const { data, error } = await adminClient.rpc("get_user_secret", {
      _connection_id: connectionId,
      _user_id: userId,
      _secret_name: "api_key",
      _encryption_key: hexKey,
    });
    if (error) {
      console.warn("[search-atlas/vault] get_user_secret error:", error.message);
      return null;
    }
    return typeof data === "string" && data.trim().length > 0 ? data.trim() : null;
  } catch (e) {
    console.warn("[search-atlas/vault] threw:", e instanceof Error ? e.message : e);
    return null;
  }
}

type AuthCtx = {
  apiKey: string;
  userId: string | null;
  connectionId: string | null;
  metadata: Record<string, unknown>;
};

async function resolveAuth(req: Request, override?: string): Promise<AuthCtx> {
  const trimmed = override?.trim();
  let userId: string | null = null;
  let connectionId: string | null = null;
  let metadata: Record<string, unknown> = {};

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization");

  if (authHeader) {
    try {
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      if (user) {
        userId = user.id;
        const adminClient = createClient(supabaseUrl, serviceRoleKey);
        const { data: rows } = await adminClient
          .from("integration_connections")
          .select("id, metadata")
          .eq("user_id", user.id)
          .eq("provider", "search_atlas")
          .order("updated_at", { ascending: false })
          .limit(1);
        const row = rows?.[0];
        if (row) {
          connectionId = row.id as string;
          metadata = (row.metadata || {}) as Record<string, unknown>;
          if (!trimmed) {
            const vaultKey = await tryVaultRead(adminClient, row.id as string, user.id);
            if (vaultKey) {
              return { apiKey: vaultKey, userId, connectionId, metadata };
            }
            const legacy = typeof metadata.api_key === "string" ? metadata.api_key.trim() : "";
            if (legacy) return { apiKey: legacy, userId, connectionId, metadata };
          }
        }
      }
    } catch (e) {
      console.warn("[search-atlas] auth resolve failed:", e instanceof Error ? e.message : e);
    }
  }

  if (trimmed) return { apiKey: trimmed, userId, connectionId, metadata };

  const envKey = Deno.env.get("SEARCH_ATLAS_API_KEY")?.trim();
  if (envKey) return { apiKey: envKey, userId, connectionId, metadata };

  throw new Error("Search Atlas API key not configured for this user");
}

// ============================================================================
// HTTP HELPER
// ============================================================================

async function saCall(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: unknown; raw: string; scheme?: AuthScheme }> {
  const baseUrl = path.startsWith("http") ? path : `${SEARCH_ATLAS_BASE}${path}`;

  const order: AuthScheme[] = cachedScheme
    ? [cachedScheme, ...AUTH_SCHEMES.filter((s) => s !== cachedScheme)]
    : AUTH_SCHEMES;

  let last: { ok: boolean; status: number; data: unknown; raw: string; scheme: AuthScheme } | null = null;
  for (const scheme of order) {
    const { finalUrl, headers } = buildAuthRequest(apiKey, baseUrl, scheme, init);
    try {
      const res = await fetch(finalUrl, { ...init, headers });
      const raw = await res.text();
      let data: unknown = raw;
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = sanitizeDetail(raw); }
      last = { ok: res.ok, status: res.status, data, raw, scheme };
      if (res.ok) {
        cachedScheme = scheme;
        return last;
      }
      // 401/403/404 → try next scheme. Other errors (5xx, 429) → return immediately.
      if (![401, 403, 404].includes(res.status)) {
        return last;
      }
    } catch (e) {
      last = {
        ok: false,
        status: 0,
        data: e instanceof Error ? e.message : "fetch failed",
        raw: "",
        scheme,
      };
    }
  }
  return last!;
}

function fail(message: string, status = 400, detail?: unknown): Response {
  let cleanDetail = detail;
  if (typeof detail === "string") cleanDetail = sanitizeDetail(detail);
  return new Response(
    JSON.stringify({ success: false, error: message, status, detail: cleanDetail }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

function ok(payload: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({ success: true, ...payload }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ============================================================================
// SNAPSHOT CACHE
// ============================================================================

async function writeSnapshot(
  userId: string | null,
  kind: string,
  domain: string | null,
  payload: unknown,
  projectId?: string | null,
): Promise<void> {
  if (!userId) return;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);
    await admin.from("search_atlas_snapshots").insert({
      user_id: userId,
      kind,
      domain,
      project_id: projectId ?? null,
      payload: payload as never,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[search-atlas] snapshot write failed:", e instanceof Error ? e.message : e);
  }
}

async function logSyncRun(
  userId: string | null,
  connectionId: string | null,
  status: "running" | "success" | "error",
  records: number,
  errorMsg?: string,
): Promise<void> {
  if (!userId || !connectionId) return;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);
    await admin.from("integration_sync_runs").insert({
      user_id: userId,
      connection_id: connectionId,
      sync_type: "search_atlas",
      direction: "inbound",
      status,
      records_processed: records,
      started_at: new Date().toISOString(),
      completed_at: status === "running" ? null : new Date().toISOString(),
      error_message: errorMsg || null,
    });
  } catch (e) {
    console.warn("[search-atlas] sync run log failed:", e instanceof Error ? e.message : e);
  }
}

// ============================================================================
// ACTION HANDLERS
// ============================================================================

async function actionTestConnection(auth: AuthCtx) {
  // Cheapest valid call to validate token against the customer account endpoint.
  const r = await saCall(auth.apiKey, "/api/customer/account/");
  if (!r.ok) {
    return fail(
      `Search Atlas auth failed (HTTP ${r.status})`,
      r.status,
      typeof r.data === "string" ? r.data : JSON.stringify(r.data).slice(0, 400),
    );
  }
  return ok({
    connected: true,
    detail: `Token validated via /api/customer/account/ (auth scheme: ${r.scheme})`,
    sample: r.data,
  });
}

async function actionListProjects(auth: AuthCtx) {
  const r = await saCall(auth.apiKey, "/api/v3/customer/projects/?page_size=100");
  if (!r.ok) return fail(`list_projects failed (HTTP ${r.status})`, r.status, r.data);
  return ok({ projects: r.data });
}

async function actionAuditSite(auth: AuthCtx, params: Record<string, unknown>) {
  const domain = String(params.domain || "").trim();
  if (!domain) return fail("domain is required", 400);
  const r = await saCall(
    auth.apiKey,
    `/api/v3/site-audits/?domain=${encodeURIComponent(domain)}`,
  );
  if (!r.ok) return fail(`audit_site failed (HTTP ${r.status})`, r.status, r.data);
  await writeSnapshot(auth.userId, "audit", domain, r.data);
  return ok({ domain, audit: r.data });
}

async function actionSiteExplorer(auth: AuthCtx, params: Record<string, unknown>) {
  const domain = String(params.domain || "").trim();
  if (!domain) return fail("domain is required", 400);
  const r = await saCall(
    auth.apiKey,
    `/api/v3/site-explorer/overview/?target=${encodeURIComponent(domain)}`,
  );
  if (!r.ok) return fail(`site_explorer failed (HTTP ${r.status})`, r.status, r.data);
  await writeSnapshot(auth.userId, "site_explorer", domain, r.data);
  return ok({ domain, overview: r.data });
}

async function actionKeywordResearch(auth: AuthCtx, params: Record<string, unknown>) {
  const keyword = String(params.keyword || "").trim();
  if (!keyword) return fail("keyword is required", 400);
  const country = String(params.country || "us").toLowerCase();
  const limit = Math.min(Number(params.limit) || 50, 200);
  const r = await saCall(
    auth.apiKey,
    `/api/v3/keyword-researcher/?keyword=${encodeURIComponent(keyword)}&country=${encodeURIComponent(country)}&limit=${limit}`,
  );
  if (!r.ok) return fail(`keyword_research failed (HTTP ${r.status})`, r.status, r.data);
  await writeSnapshot(auth.userId, "keywords", keyword, r.data);
  return ok({ keyword, country, results: r.data });
}

async function actionSerpSnapshot(auth: AuthCtx, params: Record<string, unknown>) {
  const keyword = String(params.keyword || "").trim();
  if (!keyword) return fail("keyword is required", 400);
  const country = String(params.country || "us").toLowerCase();
  const r = await saCall(
    auth.apiKey,
    `/api/v3/serp/?keyword=${encodeURIComponent(keyword)}&country=${encodeURIComponent(country)}`,
  );
  if (!r.ok) return fail(`serp_snapshot failed (HTTP ${r.status})`, r.status, r.data);
  return ok({ keyword, country, serp: r.data });
}

async function actionBacklinksOverview(auth: AuthCtx, params: Record<string, unknown>) {
  const domain = String(params.domain || "").trim();
  if (!domain) return fail("domain is required", 400);
  const r = await saCall(
    auth.apiKey,
    `/api/v3/backlinks/overview/?target=${encodeURIComponent(domain)}`,
  );
  if (!r.ok) return fail(`backlinks_overview failed (HTTP ${r.status})`, r.status, r.data);
  await writeSnapshot(auth.userId, "backlinks_overview", domain, r.data);
  return ok({ domain, overview: r.data });
}

async function actionBacklinksList(auth: AuthCtx, params: Record<string, unknown>) {
  const domain = String(params.domain || "").trim();
  if (!domain) return fail("domain is required", 400);
  const type = String(params.type || "active");
  const limit = Math.min(Number(params.limit) || 50, 500);
  const r = await saCall(
    auth.apiKey,
    `/api/v3/backlinks/?target=${encodeURIComponent(domain)}&type=${encodeURIComponent(type)}&limit=${limit}`,
  );
  if (!r.ok) return fail(`backlinks_list failed (HTTP ${r.status})`, r.status, r.data);
  return ok({ domain, type, backlinks: r.data });
}

async function actionRankTracker(auth: AuthCtx, params: Record<string, unknown>) {
  const projectId = String(params.projectId || params.project_id || "").trim();
  if (!projectId) return fail("projectId is required", 400);
  const r = await saCall(
    auth.apiKey,
    `/api/v3/rank-tracker/projects/${encodeURIComponent(projectId)}/keywords/`,
  );
  if (!r.ok) return fail(`rank_tracker failed (HTTP ${r.status})`, r.status, r.data);
  await writeSnapshot(auth.userId, "rank_tracker", null, r.data, projectId);
  return ok({ projectId, keywords: r.data });
}

async function actionSyncNow(auth: AuthCtx, params: Record<string, unknown>) {
  const domain = String(params.domain || "").trim();
  const projectId = String(params.projectId || params.project_id || "").trim();
  if (!domain && !projectId) {
    return fail("Provide a domain and/or projectId for sync_now", 400);
  }

  await logSyncRun(auth.userId, auth.connectionId, "running", 0);
  const results: Record<string, unknown> = {};
  let recordCount = 0;
  const errors: string[] = [];

  if (domain) {
    for (const [key, path] of [
      ["audit", `/api/v3/site-audits/?domain=${encodeURIComponent(domain)}`],
      ["site_explorer", `/api/v3/site-explorer/overview/?target=${encodeURIComponent(domain)}`],
      ["backlinks_overview", `/api/v3/backlinks/overview/?target=${encodeURIComponent(domain)}`],
    ] as const) {
      try {
        const r = await saCall(auth.apiKey, path);
        if (r.ok) {
          results[key] = r.data;
          await writeSnapshot(auth.userId, key, domain, r.data);
          recordCount += 1;
        } else {
          errors.push(`${key}: HTTP ${r.status}`);
        }
      } catch (e) {
        errors.push(`${key}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }
  }

  if (projectId) {
    try {
      const r = await saCall(
        auth.apiKey,
        `/api/v3/rank-tracker/projects/${encodeURIComponent(projectId)}/keywords/`,
      );
      if (r.ok) {
        results.rank_tracker = r.data;
        await writeSnapshot(auth.userId, "rank_tracker", domain || null, r.data, projectId);
        recordCount += 1;
      } else {
        errors.push(`rank_tracker: HTTP ${r.status}`);
      }
    } catch (e) {
      errors.push(`rank_tracker: ${e instanceof Error ? e.message : "unknown"}`);
    }
  }

  const finalStatus = errors.length === 0 ? "success" : recordCount > 0 ? "success" : "error";
  await logSyncRun(
    auth.userId,
    auth.connectionId,
    finalStatus,
    recordCount,
    errors.length ? errors.join("; ") : undefined,
  );

  return ok({
    domain: domain || null,
    projectId: projectId || null,
    records_processed: recordCount,
    results,
    errors: errors.length ? errors : undefined,
  });
}

async function actionRecentSnapshots(auth: AuthCtx, params: Record<string, unknown>) {
  if (!auth.userId) return fail("Authentication required", 401);
  const domain = params.domain ? String(params.domain).trim() : null;
  const limit = Math.min(Number(params.limit) || 10, 50);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);
  let q = admin
    .from("search_atlas_snapshots")
    .select("id, kind, domain, project_id, fetched_at, payload")
    .eq("user_id", auth.userId)
    .order("fetched_at", { ascending: false })
    .limit(limit);
  if (domain) q = q.eq("domain", domain);
  const { data, error } = await q;
  if (error) return fail(`recent_snapshots failed: ${error.message}`, 500);
  return ok({ snapshots: data || [] });
}

// ============================================================================
// MAIN
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();
    const params = (body.params || {}) as Record<string, unknown>;
    const tokenOverride = typeof params.api_key === "string" ? params.api_key : undefined;

    if (!action) return fail("action is required", 400);

    const auth = await resolveAuth(req, tokenOverride);

    switch (action) {
      case "connect":
      case "test_connection":
        return await actionTestConnection(auth);
      case "list_projects":
        return await actionListProjects(auth);
      case "audit_site":
        return await actionAuditSite(auth, params);
      case "site_explorer":
        return await actionSiteExplorer(auth, params);
      case "keyword_research":
        return await actionKeywordResearch(auth, params);
      case "serp_snapshot":
        return await actionSerpSnapshot(auth, params);
      case "backlinks_overview":
        return await actionBacklinksOverview(auth, params);
      case "backlinks_list":
        return await actionBacklinksList(auth, params);
      case "rank_tracker_keywords":
      case "rank_tracker":
        return await actionRankTracker(auth, params);
      case "sync_now":
        return await actionSyncNow(auth, params);
      case "recent_snapshots":
        return await actionRecentSnapshots(auth, params);
      default:
        return fail(`Unknown action: ${action}`, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[search-atlas] error:", msg);
    return fail(msg, 500);
  }
});
