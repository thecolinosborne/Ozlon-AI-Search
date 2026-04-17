// Plaid edge function — single action router for Finance feature.
// Actions: create_link_token, exchange_public_token, accounts, balances,
// transactions, sync_transactions, update_link_token, disconnect_item.
//
// Access tokens are stored encrypted via existing store_user_secret /
// get_user_secret RPCs (AES-CBC) keyed by VAULT_ENCRYPTION_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PLAID_ENV = (Deno.env.get("PLAID_ENV") || "sandbox").trim().toLowerCase();
const PLAID_HOST =
  PLAID_ENV === "production"
    ? "https://production.plaid.com"
    : PLAID_ENV === "development"
    ? "https://development.plaid.com"
    : "https://sandbox.plaid.com";
const PLAID_CLIENT_ID = (Deno.env.get("PLAID_CLIENT_ID") || "").trim();

// Pick the right secret based on environment.
// sandbox -> PLAID_SANDBOX_SECRET, production -> PLAID_PRODUCTION_SECRET.
// Falls back to legacy PLAID_SECRET so nothing breaks mid-rollout.
const SANDBOX_SECRET = (Deno.env.get("PLAID_SANDBOX_SECRET") || "").trim();
const PRODUCTION_SECRET = (Deno.env.get("PLAID_PRODUCTION_SECRET") || "").trim();
const LEGACY_SECRET = (Deno.env.get("PLAID_SECRET") || "").trim();

let PLAID_SECRET = "";
let SECRET_SOURCE = "none";
if (PLAID_ENV === "production") {
  if (PRODUCTION_SECRET) { PLAID_SECRET = PRODUCTION_SECRET; SECRET_SOURCE = "PLAID_PRODUCTION_SECRET"; }
  else if (LEGACY_SECRET) { PLAID_SECRET = LEGACY_SECRET; SECRET_SOURCE = "PLAID_SECRET (legacy)"; }
} else {
  if (SANDBOX_SECRET) { PLAID_SECRET = SANDBOX_SECRET; SECRET_SOURCE = "PLAID_SANDBOX_SECRET"; }
  else if (LEGACY_SECRET) { PLAID_SECRET = LEGACY_SECRET; SECRET_SOURCE = "PLAID_SECRET (legacy)"; }
}

const VAULT_KEY_RAW = Deno.env.get("VAULT_ENCRYPTION_KEY")!;

function diagnostics() {
  return {
    env: PLAID_ENV,
    host: PLAID_HOST,
    client_id_len: PLAID_CLIENT_ID.length,
    secret_len: PLAID_SECRET.length,
    secret_source: SECRET_SOURCE,
  };
}

function keyToHex(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  if (bytes.length !== 32) throw new Error(`VAULT_ENCRYPTION_KEY must be 32 bytes (got ${bytes.length})`);
  return "\\x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

class PlaidError extends Error {
  request_id?: string;
  error_code?: string;
  constructor(message: string, request_id?: string, error_code?: string) {
    super(message);
    this.request_id = request_id;
    this.error_code = error_code;
  }
}

async function plaidFetch(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${PLAID_HOST}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error_message || json?.error_code || `Plaid ${res.status}`;
    throw new PlaidError(msg, json?.request_id, json?.error_code);
  }
  return json;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user?.id) return json({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;
    const vaultKeyHex = keyToHex(VAULT_KEY_RAW);

    const audit = (a: string, detail?: string, connection_id?: string) =>
      admin.from("credential_audit_log").insert({
        user_id: userId,
        provider: "plaid",
        connection_id: connection_id ?? null,
        action: a,
        detail: detail ?? null,
      });

    // ---- get access_token for an item via vault ----
    async function getAccessToken(itemRowId: string): Promise<{ token: string; connection_id: string }> {
      const { data: item } = await admin
        .from("plaid_items")
        .select("connection_id")
        .eq("id", itemRowId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!item?.connection_id) throw new Error("Item not found");
      const { data: token, error } = await admin.rpc("get_user_secret", {
        _connection_id: item.connection_id,
        _user_id: userId,
        _secret_name: "access_token",
        _encryption_key: vaultKeyHex,
      });
      if (error || !token) throw new Error("Access token unavailable");
      return { token: token as string, connection_id: item.connection_id };
    }

    switch (action) {
      // ------------------------------------------------------------------
      case "create_link_token": {
        const { mode, item_id, redirect_uri } = body as {
          mode?: "create" | "update";
          item_id?: string;
          redirect_uri?: string;
        };

        const payload: Record<string, unknown> = {
          user: { client_user_id: userId },
          client_name: "Ozlon Finance",
          language: "en",
          country_codes: (Deno.env.get("PLAID_COUNTRY_CODES") || "US").split(","),
          // OAuth: include redirect_uri when provided (must be allowlisted in Plaid dashboard)
          ...(redirect_uri ? { redirect_uri } : {}),
        };

        if (mode === "update" && item_id) {
          // Repair/relink mode — provide existing access token, do NOT include products
          const { token } = await getAccessToken(item_id);
          payload.access_token = token;
        } else {
          payload.products = (Deno.env.get("PLAID_PRODUCTS") || "transactions").split(",");
        }

        const result = await plaidFetch("/link/token/create", payload);
        return json({ link_token: result.link_token, expiration: result.expiration });
      }

      // ------------------------------------------------------------------
      case "exchange_public_token": {
        const { public_token, metadata } = body as { public_token: string; metadata?: any };
        if (!public_token) return json({ error: "public_token required" }, 400);

        const exchange = await plaidFetch("/item/public_token/exchange", { public_token });
        const accessToken = exchange.access_token as string;
        const itemId = exchange.item_id as string;

        // Create integration_connections row to anchor the vault secret
        const institution = metadata?.institution || {};
        const { data: conn, error: connErr } = await admin
          .from("integration_connections")
          .insert({
            user_id: userId,
            provider: "plaid",
            auth_type: "oauth",
            status: "connected",
            external_account_id: itemId,
            external_account_label: institution.name || "Bank",
            metadata: { institution_id: institution.institution_id, institution_name: institution.name },
            last_validated_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (connErr || !conn) throw new Error(connErr?.message || "Failed to create connection");

        // Encrypt access_token into vault
        await admin.rpc("store_user_secret", {
          _connection_id: conn.id,
          _user_id: userId,
          _plaintext: accessToken,
          _encryption_key: vaultKeyHex,
          _secret_name: "access_token",
        });

        // Create plaid_items row
        const { data: itemRow, error: itemErr } = await admin
          .from("plaid_items")
          .insert({
            user_id: userId,
            connection_id: conn.id,
            item_id: itemId,
            institution_id: institution.institution_id,
            institution_name: institution.name,
            status: "active",
          })
          .select("id")
          .single();
        if (itemErr || !itemRow) throw new Error(itemErr?.message || "Failed to create item");

        // Immediately fetch accounts
        const acct = await plaidFetch("/accounts/get", { access_token: accessToken });
        const accountRows = (acct.accounts || []).map((a: any) => ({
          user_id: userId,
          plaid_item_id: itemRow.id,
          account_id: a.account_id,
          name: a.name,
          official_name: a.official_name,
          mask: a.mask,
          type: a.type,
          subtype: a.subtype,
          current_balance: a.balances?.current,
          available_balance: a.balances?.available,
          iso_currency_code: a.balances?.iso_currency_code,
        }));
        if (accountRows.length) {
          await admin.from("plaid_accounts").upsert(accountRows, { onConflict: "account_id" });
        }

        await audit("plaid_connect", institution.name || itemId, conn.id);
        return json({ ok: true, item_id: itemRow.id, institution_name: institution.name });
      }

      // ------------------------------------------------------------------
      case "accounts": {
        const { data } = await admin
          .from("plaid_accounts")
          .select("*, plaid_items!inner(institution_name, status)")
          .eq("user_id", userId)
          .order("created_at", { ascending: true });
        return json({ accounts: data || [] });
      }

      // ------------------------------------------------------------------
      case "balances": {
        // Refresh balances per item
        const { data: items } = await admin
          .from("plaid_items")
          .select("id")
          .eq("user_id", userId)
          .eq("status", "active");
        for (const it of items || []) {
          try {
            const { token } = await getAccessToken(it.id);
            const r = await plaidFetch("/accounts/balance/get", { access_token: token });
            for (const a of r.accounts || []) {
              await admin
                .from("plaid_accounts")
                .update({
                  current_balance: a.balances?.current,
                  available_balance: a.balances?.available,
                  iso_currency_code: a.balances?.iso_currency_code,
                })
                .eq("account_id", a.account_id)
                .eq("user_id", userId);
            }
          } catch (e) {
            console.error("balance refresh error", e);
          }
        }
        const { data } = await admin
          .from("plaid_accounts")
          .select("*")
          .eq("user_id", userId);
        return json({ accounts: data || [] });
      }

      // ------------------------------------------------------------------
      case "transactions": {
        const { account_id, limit = 50 } = body as { account_id?: string; limit?: number };
        let q = admin
          .from("plaid_transactions")
          .select("*")
          .eq("user_id", userId)
          .order("posted_date", { ascending: false, nullsFirst: false })
          .limit(Math.min(limit, 200));
        if (account_id) q = q.eq("account_id", account_id);
        const { data } = await q;
        return json({ transactions: data || [] });
      }

      // ------------------------------------------------------------------
      case "sync_transactions": {
        const { item_id } = body as { item_id?: string };
        const { data: items } = await admin
          .from("plaid_items")
          .select("id, cursor")
          .eq("user_id", userId)
          .eq("status", "active")
          .match(item_id ? { id: item_id } : {});

        let totalAdded = 0, totalModified = 0, totalRemoved = 0;
        for (const it of items || []) {
          try {
            const { token } = await getAccessToken(it.id);
            let cursor = it.cursor || undefined;
            let hasMore = true;
            while (hasMore) {
              const r = await plaidFetch("/transactions/sync", {
                access_token: token,
                ...(cursor ? { cursor } : {}),
              });
              const added = (r.added || []).map((t: any) => mapTx(t, userId, it.id));
              const modified = (r.modified || []).map((t: any) => mapTx(t, userId, it.id));
              const removedIds = (r.removed || []).map((t: any) => t.transaction_id);
              if (added.length) await admin.from("plaid_transactions").upsert(added, { onConflict: "transaction_id" });
              if (modified.length) await admin.from("plaid_transactions").upsert(modified, { onConflict: "transaction_id" });
              if (removedIds.length) await admin.from("plaid_transactions").delete().in("transaction_id", removedIds);
              totalAdded += added.length;
              totalModified += modified.length;
              totalRemoved += removedIds.length;
              cursor = r.next_cursor;
              hasMore = r.has_more;
            }
            await admin
              .from("plaid_items")
              .update({ cursor, last_synced_at: new Date().toISOString(), last_error: null })
              .eq("id", it.id);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await admin.from("plaid_items").update({ last_error: msg }).eq("id", it.id);
            await audit("plaid_sync_failure", msg);
          }
        }
        await audit("plaid_sync", `added=${totalAdded} modified=${totalModified} removed=${totalRemoved}`);
        return json({ ok: true, added: totalAdded, modified: totalModified, removed: totalRemoved });
      }

      // ------------------------------------------------------------------
      case "update_link_token": {
        const { item_id, redirect_uri } = body as { item_id: string; redirect_uri?: string };
        const { token } = await getAccessToken(item_id);
        const result = await plaidFetch("/link/token/create", {
          user: { client_user_id: userId },
          client_name: "Ozlon Finance",
          language: "en",
          country_codes: (Deno.env.get("PLAID_COUNTRY_CODES") || "US").split(","),
          access_token: token,
          ...(redirect_uri ? { redirect_uri } : {}),
        });
        await audit("plaid_repair_request", item_id);
        return json({ link_token: result.link_token });
      }

      // ------------------------------------------------------------------
      case "disconnect_item": {
        const { item_id } = body as { item_id: string };
        if (!item_id) return json({ error: "item_id required" }, 400);
        const { data: item } = await admin
          .from("plaid_items")
          .select("id, connection_id, institution_name")
          .eq("id", item_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (!item) return json({ error: "Not found" }, 404);
        try {
          const { token } = await getAccessToken(item_id);
          await plaidFetch("/item/remove", { access_token: token });
        } catch (e) {
          console.error("plaid item/remove failed (continuing cleanup)", e);
        }
        // Cascade deletes accounts + transactions via FK
        await admin.from("plaid_items").delete().eq("id", item_id).eq("user_id", userId);
        if (item.connection_id) {
          await admin.from("integration_connections").delete().eq("id", item.connection_id).eq("user_id", userId);
        }
        await audit("plaid_disconnect", item.institution_name || item_id, item.connection_id || undefined);
        return json({ ok: true });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("[plaid] fatal:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    const diag = diagnostics();
    const extra: Record<string, unknown> = {};
    if (err instanceof PlaidError) {
      if (err.request_id) extra.request_id = err.request_id;
      if (err.error_code) extra.error_code = err.error_code;
    }
    // Return HTTP 200 with structured envelope so the client can surface the real error
    // instead of the generic "non-2xx" transport error from supabase.functions.invoke.
    return json({ ok: false, error: message, diagnostics: diag, ...extra }, 200);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapTx(t: any, userId: string, itemRowId: string) {
  return {
    user_id: userId,
    plaid_item_id: itemRowId,
    account_id: t.account_id,
    transaction_id: t.transaction_id,
    merchant_name: t.merchant_name,
    name: t.name,
    amount: t.amount,
    iso_currency_code: t.iso_currency_code,
    category_primary: t.personal_finance_category?.primary || t.category?.[0] || null,
    category_detailed: t.personal_finance_category?.detailed || (t.category?.length ? t.category.join(" / ") : null),
    authorized_date: t.authorized_date || null,
    posted_date: t.date || null,
    pending: !!t.pending,
    raw_json: t,
  };
}
