import { supabase } from "@/integrations/supabase/client";

// Metadata keys that hold raw secret material and should ALSO be encrypted into the vault.
// Map: metadata key -> secret_name to use in integration_credentials.
const SECRET_METADATA_KEYS: Record<string, string> = {
  api_key: "api_key",
  app_id: "app_id",
  access_token: "access_token",
  refresh_token: "refresh_token",
};

async function vaultStore(connectionId: string, plaintext: string, secretName: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("vault-store", {
      body: { connection_id: connectionId, plaintext, secret_name: secretName },
    });
    if (error) console.warn(`[vault-store] failed for ${secretName}:`, error.message);
  } catch (e) {
    console.warn(`[vault-store] threw for ${secretName}:`, e);
  }
}

/**
 * Upsert an integration connection for the current user.
 * Stores API keys in the per-user integration_connections table (RLS-protected)
 * AND mirrors any secret material into the encrypted integration_credentials vault.
 */
export async function upsertIntegrationConnection(
  provider: string,
  metadata: Record<string, string>,
  authType = "api_key"
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: existing } = await supabase
    .from("integration_connections")
    .select("id, metadata")
    .eq("user_id", user.id)
    .eq("provider", provider)
    .maybeSingle();

  let connectionId: string;

  if (existing) {
    const merged = { ...(existing.metadata as Record<string, unknown> || {}), ...metadata } as Record<string, string>;
    await supabase
      .from("integration_connections")
      .update({
        metadata: merged as unknown as Record<string, string>,
        status: "connected",
        auth_type: authType,
        last_validated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    connectionId = existing.id;
  } else {
    const { data: inserted } = await supabase
      .from("integration_connections")
      .insert({
        user_id: user.id,
        provider,
        auth_type: authType,
        status: "connected",
        metadata,
        last_validated_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (!inserted?.id) throw new Error("Failed to create connection");
    connectionId = inserted.id;
  }

  // Dual-write: mirror any secret values from metadata into the encrypted vault.
  // Best-effort — failures don't block the legacy metadata write.
  for (const [metaKey, secretName] of Object.entries(SECRET_METADATA_KEYS)) {
    const value = metadata[metaKey];
    if (typeof value === "string" && value.length > 0) {
      await vaultStore(connectionId, value, secretName);
    }
  }
}

/**
 * Disconnect an integration for the current user.
 */
export async function disconnectIntegration(provider: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("integration_connections")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", provider);
}
