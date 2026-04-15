import { supabase } from "@/integrations/supabase/client";

/**
 * Upsert an integration connection for the current user.
 * Stores API keys in the per-user integration_connections table (RLS-protected).
 */
export async function upsertIntegrationConnection(
  provider: string,
  metadata: Record<string, string>,
  authType = "api_key"
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Check if a connection already exists for this user + provider
  const { data: existing } = await supabase
    .from("integration_connections")
    .select("id, metadata")
    .eq("user_id", user.id)
    .eq("provider", provider)
    .maybeSingle();

  if (existing) {
    // Merge metadata and update
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
  } else {
    await supabase.from("integration_connections").insert({
      user_id: user.id,
      provider,
      auth_type: authType,
      status: "connected",
      metadata,
      last_validated_at: new Date().toISOString(),
    });
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
