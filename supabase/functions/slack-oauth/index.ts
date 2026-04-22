// Slack OAuth install + callback for multi-tenant workspace installs.
// GET ?action=install&user_id=...  → redirect to Slack consent
// GET ?action=callback&code=...&state=...  → exchange + store in integration_connections
//
// Requires: SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Public function (verify_jwt = false) — Slack will call /callback directly.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLACK_CLIENT_ID = Deno.env.get("SLACK_CLIENT_ID")!;
const SLACK_CLIENT_SECRET = Deno.env.get("SLACK_CLIENT_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/slack-oauth?action=callback`;

const SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "im:write",
  "mpim:history",
  "mpim:read",
  "reactions:write",
  "users:read",
  "users:read.email",
  "search:read.files",
  "search:read.im",
  "search:read.users",
].join(",");

// Where to send the user after install completes. Adjust if you want a different post-install URL.
function postInstallUrl(req: Request): string {
  const origin = req.headers.get("origin") || req.headers.get("referer") || "";
  // Best effort: derive app origin from referer/host; default to ozlon.ai.
  try {
    if (origin) return new URL("/integrations/slack", origin).toString();
  } catch { /* ignore */ }
  return "https://ozlon.ai/integrations/slack";
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- minimal HMAC-signed state (user_id + nonce + ts) ---
async function signState(userId: string): Promise<string> {
  const payload = { u: userId, n: crypto.randomUUID(), t: Date.now() };
  const json = JSON.stringify(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SLACK_CLIENT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(json));
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  const body = btoa(json);
  return `${body}.${sig}`;
}

async function verifyState(state: string): Promise<{ u: string } | null> {
  try {
    const [body, sig] = state.split(".");
    if (!body || !sig) return null;
    const json = atob(body);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SLACK_CLIENT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expectedBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(json));
    const expected = btoa(String.fromCharCode(...new Uint8Array(expectedBuf)));
    if (expected !== sig) return null;
    const parsed = JSON.parse(json) as { u: string; t: number };
    // 15 minute expiry
    if (Date.now() - parsed.t > 15 * 60 * 1000) return null;
    return { u: parsed.u };
  } catch {
    return null;
  }
}

function html(body: string, status = 200): Response {
  return new Response(`<!doctype html><html><body style="font-family:system-ui;padding:40px;text-align:center">${body}</body></html>`, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "install";

  if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET) {
    return html(`<h2>Slack not configured</h2><p>Missing SLACK_CLIENT_ID or SLACK_CLIENT_SECRET.</p>`, 500);
  }

  // ---- INSTALL: redirect to Slack consent ----
  if (action === "install") {
    const userId = url.searchParams.get("user_id");
    if (!userId) {
      return html(`<h2>Missing user_id</h2><p>Open this from the Integrations page.</p>`, 400);
    }
    const state = await signState(userId);
    const slackUrl = new URL("https://slack.com/oauth/v2/authorize");
    slackUrl.searchParams.set("client_id", SLACK_CLIENT_ID);
    slackUrl.searchParams.set("scope", SCOPES);
    slackUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    slackUrl.searchParams.set("state", state);
    return Response.redirect(slackUrl.toString(), 302);
  }

  // ---- CALLBACK: exchange code, store token ----
  if (action === "callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const err = url.searchParams.get("error");
    if (err) return html(`<h2>Slack install cancelled</h2><p>${err}</p>`, 400);
    if (!code || !state) return html(`<h2>Missing code or state</h2>`, 400);

    const verified = await verifyState(state);
    if (!verified) return html(`<h2>Invalid or expired state</h2>`, 400);

    // Exchange code for token
    const exchangeRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: SLACK_CLIENT_ID,
        client_secret: SLACK_CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const data = await exchangeRes.json();
    if (!data.ok) {
      console.error("[slack-oauth] exchange failed", data);
      return html(`<h2>Slack install failed</h2><p>${data.error || "unknown error"}</p>`, 400);
    }

    const accessToken = data.access_token as string;
    const teamId = data.team?.id as string;
    const teamName = data.team?.name as string;
    const botUserId = data.bot_user_id as string;
    const scope = data.scope as string;
    const authedUser = data.authed_user?.id as string | undefined;

    // Upsert connection for this user
    const { data: existing } = await sb
      .from("integration_connections")
      .select("id, metadata")
      .eq("user_id", verified.u)
      .eq("provider", "slack")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const metadata = {
      access_token: accessToken,
      team_id: teamId,
      team_name: teamName,
      bot_user_id: botUserId,
      authed_user: authedUser,
      scope,
    };

    if (existing) {
      await sb
        .from("integration_connections")
        .update({
          metadata: { ...(existing.metadata as Record<string, unknown> || {}), ...metadata },
          status: "connected",
          auth_type: "oauth2",
          last_validated_at: new Date().toISOString(),
          external_account_id: teamId,
          external_account_label: teamName,
        })
        .eq("id", existing.id);
    } else {
      await sb.from("integration_connections").insert({
        user_id: verified.u,
        provider: "slack",
        auth_type: "oauth2",
        status: "connected",
        metadata,
        external_account_id: teamId,
        external_account_label: teamName,
        last_validated_at: new Date().toISOString(),
      });
    }

    // Redirect back to the app
    const dest = postInstallUrl(req);
    return new Response(
      `<!doctype html><html><body style="font-family:system-ui;padding:40px;text-align:center">
        <h2>✓ Slack connected to ${teamName || "your workspace"}</h2>
        <p>Redirecting…</p>
        <script>window.location="${dest}"</script>
      </body></html>`,
      { headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  return html(`<h2>Unknown action</h2>`, 400);
});
