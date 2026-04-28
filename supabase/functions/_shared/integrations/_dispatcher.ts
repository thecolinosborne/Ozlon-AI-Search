// Universal dispatcher — call any registered tool with the correct envelope.
// Permanently kills the envelope-mismatch bug class: each integration declares
// `envelope: "nested" | "flat"` in its manifest, dispatcher honors it.

import { getRoute } from "./index.ts";

export interface DispatchResult {
  success: boolean;
  result: string;
  /** True iff the tool was found in the registry (so caller knows whether to try legacy fallback). */
  routed: boolean;
  /** Raw response data when success. */
  data?: unknown;
}

export async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>,
  authHeader: string,
): Promise<DispatchResult> {
  const route = getRoute(toolName);
  if (!route) {
    return { success: false, routed: false, result: `Tool not in registry: ${toolName}` };
  }
  // Harden against null/undefined args (AI sometimes omits the args object entirely).
  const safeArgs: Record<string, unknown> = (args && typeof args === "object") ? args : {};

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return { success: false, routed: true, result: "Missing SUPABASE_URL / SUPABASE_ANON_KEY in dispatcher" };
  }

  let mapped: Record<string, unknown>;
  try {
    mapped = route.mapArgs(safeArgs) ?? {};
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, routed: true, result: `Tool ${toolName} arg mapping failed: ${msg}` };
  }
  const payload = route.envelope === "nested"
    ? { action: route.action, params: mapped }
    : { action: route.action, ...mapped };

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/${route.edgeFunction}`, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "apikey": anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

    if (!res.ok || data?.success === false) {
      const rawErr = data?.error;
      let errMsg: string;
      if (typeof rawErr === "string" && rawErr.length > 0) {
        errMsg = rawErr;
      } else if (rawErr && typeof rawErr === "object") {
        // Structured error block (e.g. { category, ghl_status, ghl_message, minimum_fix })
        const e = rawErr as Record<string, unknown>;
        const parts: string[] = [];
        if (e.category) parts.push(`category=${e.category}`);
        if (e.ghl_status) parts.push(`status=${e.ghl_status}`);
        if (e.ghl_message) parts.push(`message=${typeof e.ghl_message === "string" ? e.ghl_message : JSON.stringify(e.ghl_message)}`);
        if (e.minimum_fix) parts.push(`fix=${e.minimum_fix}`);
        errMsg = parts.length > 0 ? parts.join(" | ") : JSON.stringify(rawErr).slice(0, 600);
      } else if (typeof data?.raw === "string") {
        errMsg = data.raw as string;
      } else {
        errMsg = `${route.edgeFunction}/${route.action} failed (HTTP ${res.status})`;
      }
      console.warn(`[dispatcher] ${toolName} → ${route.edgeFunction}/${route.action} FAILED: ${errMsg}`);
      // routed=true so caller does NOT fall through to legacy switch (which would
      // hide the real error behind "Unknown tool"). Surface the real error to the AI.
      return { success: false, routed: true, result: `Tool ${toolName} failed: ${errMsg}` };
    }

    // Run optional formatter — turns raw API JSON into AI-friendly text.
    // Failure here MUST NOT break the call; fall back to JSON slice.
    let pretty: string | null = null;
    if (route.formatter) {
      try {
        pretty = route.formatter(data, safeArgs);
      } catch (e) {
        console.warn(`[dispatcher] ${toolName} formatter threw:`, e);
      }
    }
    const body = pretty && pretty.trim().length > 0
      ? pretty
      : JSON.stringify(data).slice(0, 4000);

    console.log(
      `[dispatcher] ${toolName} → ${route.edgeFunction}/${route.action} OK ` +
        `(side=${route.sideEffect}, cost=${route.cost}, formatted=${pretty ? "yes" : "no"})`,
    );
    return {
      success: true,
      routed: true,
      data,
      result: `[${route.integrationId}] ${body}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[dispatcher] ${toolName} threw: ${msg}`);
    return { success: false, routed: true, result: `Tool ${toolName} error: ${msg}` };
  }
}

/** Run multiple tool calls with bounded concurrency + per-call isolation.
 *  One failed call NEVER aborts the others. Concurrency cap protects burst-
 *  sensitive providers from rate-limit cascades. */
export interface MultiCall { name: string; args: Record<string, unknown>; }
export interface MultiResult {
  name: string;
  success: boolean;
  result: string;
}
const MULTI_CONCURRENCY = 4;

export async function dispatchMulti(
  calls: MultiCall[],
  authHeader: string,
  fallback?: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; result: string }>,
): Promise<MultiResult[]> {
  const results: MultiResult[] = new Array(calls.length);
  let cursor = 0;

  const runOne = async (idx: number): Promise<void> => {
    const c = calls[idx];
    try {
      const safe = (c.args && typeof c.args === "object") ? c.args : {};
      const r = await dispatchTool(c.name, safe, authHeader);
      if (r.routed) {
        results[idx] = { name: c.name, success: r.success, result: r.result };
        return;
      }
      if (fallback) {
        const f = await fallback(c.name, c.args);
        results[idx] = { name: c.name, success: f.success, result: f.result };
        return;
      }
      results[idx] = { name: c.name, success: false, result: `Unknown tool: ${c.name}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[dispatchMulti] '${c.name}' threw (isolated):`, msg);
      results[idx] = { name: c.name, success: false, result: `Threw: ${msg}` };
    }
  };

  const workers = Array.from({ length: Math.min(MULTI_CONCURRENCY, calls.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= calls.length) return;
      await runOne(i);
    }
  });
  await Promise.all(workers);
  return results;
}
