import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function keyToBytes(raw: string): Uint8Array {
  // Treat VAULT_ENCRYPTION_KEY as a raw UTF-8 string (32 chars => 32 bytes for crypto_secretbox)
  const bytes = new TextEncoder().encode(raw);
  console.log(`[vault-store] key bytes: len=${bytes.length}`);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return "\\x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vaultKeyB64 = Deno.env.get("VAULT_ENCRYPTION_KEY");

    if (!vaultKeyB64) {
      return new Response(JSON.stringify({ error: "Vault encryption key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { connection_id, plaintext, secret_name, action } = body as {
      connection_id?: string;
      plaintext?: string;
      secret_name?: string;
      action?: string;
    };

    // --- Debug round-trip: decrypts via get_user_secret and returns last4 only ---
    if (action === "debug_roundtrip") {
      if (!connection_id) {
        return new Response(JSON.stringify({ error: "connection_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const keyBytesDbg = keyToBytes(vaultKeyB64);
      if (keyBytesDbg.length !== 32) {
        return new Response(JSON.stringify({ error: `VAULT_ENCRYPTION_KEY must be exactly 32 bytes (got ${keyBytesDbg.length})` }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const adminDbg = createClient(supabaseUrl, serviceKey);
      const { data: secretData, error: getErr } = await adminDbg.rpc("get_user_secret", {
        _connection_id: connection_id,
        _user_id: userId,
        _secret_name: secret_name || "api_key",
        _encryption_key: bytesToHex(keyBytesDbg),
      });
      if (getErr) {
        console.error("get_user_secret error:", getErr);
        return new Response(JSON.stringify({ error: getErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const plain = typeof secretData === "string" ? secretData : null;
      const last4 = plain && plain.length >= 4 ? plain.slice(-4) : plain;
      const length = plain ? plain.length : 0;
      await adminDbg.from("credential_audit_log").insert({
        user_id: userId,
        connection_id,
        action: "vault_debug_roundtrip",
        detail: secret_name || "api_key",
      });
      return new Response(JSON.stringify({ success: true, found: plain !== null, last4, length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!connection_id || !plaintext || typeof plaintext !== "string" || plaintext.length === 0) {
      return new Response(JSON.stringify({ error: "connection_id and plaintext required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use VAULT_ENCRYPTION_KEY as raw UTF-8 bytes (must be exactly 32 chars/bytes)
    const keyBytes = keyToBytes(vaultKeyB64);
    if (keyBytes.length !== 32) {
      return new Response(JSON.stringify({ error: `VAULT_ENCRYPTION_KEY must be exactly 32 bytes (got ${keyBytes.length})` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { error: rpcErr } = await admin.rpc("store_user_secret", {
      _connection_id: connection_id,
      _user_id: userId,
      _plaintext: plaintext,
      _encryption_key: bytesToHex(keyBytes),
      _secret_name: secret_name || "api_key",
    });

    if (rpcErr) {
      console.error("store_user_secret error:", rpcErr);
      return new Response(JSON.stringify({ error: rpcErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Audit
    await admin.from("credential_audit_log").insert({
      user_id: userId,
      connection_id,
      action: "vault_store",
      detail: secret_name || "api_key",
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("vault-store fatal:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
