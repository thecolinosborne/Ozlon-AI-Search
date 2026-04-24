// Shared helper: get a valid Google access token from the user's OAuth connection
// stored under provider='youtube' / auth_type='oauth2'. Auto-refreshes if expired.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AnyJson = Record<string, unknown>;

export function getAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export async function getAuthedUserId(req: Request): Promise<string> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new Error("Missing bearer token");
  const token = auth.slice(7);
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error("Unauthorized");
  return data.user.id;
}

export async function getGoogleAccessToken(userId: string): Promise<string> {
  const admin = getAdminClient();
  const { data: conn } = await admin
    .from("integration_connections")
    .select("id, metadata")
    .eq("user_id", userId)
    .eq("provider", "youtube")
    .eq("auth_type", "oauth2")
    .eq("status", "connected")
    .maybeSingle();

  if (!conn) throw new Error("No Google OAuth connection — connect YouTube/Google in Integrations");

  const meta = (conn.metadata || {}) as AnyJson;
  const accessToken = String(meta.access_token || "");
  const refreshToken = String(meta.refresh_token || "");
  const expiresAt = String(meta.expires_at || "");

  if (accessToken && expiresAt && new Date(expiresAt) > new Date(Date.now() + 60_000)) {
    return accessToken;
  }

  if (!refreshToken) throw new Error("OAuth token expired and no refresh token — re-authorize Google");

  const clientId = Deno.env.get("YOUTUBE_CLIENT_ID");
  const clientSecret = Deno.env.get("YOUTUBE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Google OAuth credentials not configured");

  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const refreshData = await refreshRes.json();
  if (!refreshRes.ok) {
    throw new Error(`Token refresh failed: ${JSON.stringify(refreshData)}`);
  }

  const newAccessToken = refreshData.access_token as string;
  const newExpiresAt = new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString();

  await admin
    .from("integration_connections")
    .update({
      metadata: { ...meta, access_token: newAccessToken, expires_at: newExpiresAt },
      last_validated_at: new Date().toISOString(),
    })
    .eq("id", conn.id);

  return newAccessToken;
}

/**
 * Force a refresh-token exchange regardless of cached expires_at.
 * Use this to recover from 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT or stale-token errors
 * after the user reauthorizes with new scopes.
 */
export async function forceRefreshGoogleToken(userId: string): Promise<string> {
  const admin = getAdminClient();
  const { data: conn } = await admin
    .from("integration_connections")
    .select("id, metadata")
    .eq("user_id", userId)
    .eq("provider", "youtube")
    .eq("auth_type", "oauth2")
    .eq("status", "connected")
    .maybeSingle();

  if (!conn) throw new Error("No Google OAuth connection");

  const meta = (conn.metadata || {}) as AnyJson;
  const refreshToken = String(meta.refresh_token || "");
  if (!refreshToken) throw new Error("No refresh token — re-authorize Google");

  const clientId = Deno.env.get("YOUTUBE_CLIENT_ID");
  const clientSecret = Deno.env.get("YOUTUBE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Google OAuth credentials not configured");

  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const refreshData = await refreshRes.json();
  if (!refreshRes.ok) throw new Error(`Forced token refresh failed: ${JSON.stringify(refreshData)}`);

  const newAccessToken = refreshData.access_token as string;
  const newExpiresAt = new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString();

  await admin
    .from("integration_connections")
    .update({
      metadata: { ...meta, access_token: newAccessToken, expires_at: newExpiresAt },
      last_validated_at: new Date().toISOString(),
    })
    .eq("id", conn.id);

  return newAccessToken;
}

export function jsonOk(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function jsonErr(message: string, status = 400, extra: AnyJson = {}) {
  return new Response(JSON.stringify({ success: false, error: message, ...extra }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
