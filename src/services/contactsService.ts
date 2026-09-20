import { supabase } from "@/integrations/supabase/client";

export interface ContactInput {
  display_name: string;
  primary_email?: string | null;
  primary_phone?: string | null;
  company?: string | null;
  notes?: string | null;
  starred?: boolean;
  entity_type?: string;
}

export interface SyncResult {
  ghl: "created" | "updated" | "skipped" | "failed";
  message?: string;
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] || name, lastName: parts.slice(1).join(" ") };
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}

/** Is GoHighLevel connected for this user? */
export async function isGhlConnected(): Promise<boolean> {
  const userId = await currentUserId();
  const { data } = await supabase
    .from("integration_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", "gohighlevel")
    .eq("status", "connected")
    .limit(1);
  return !!data?.length;
}

async function callGhl(action: string, payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("gohighlevel", {
    body: { action, ...payload },
  });
  if (error) throw new Error(error.message);
  if (data && (data as { error?: string }).error) throw new Error((data as { error: string }).error);
  return data as Record<string, unknown>;
}

/** Create a contact locally and optionally push it to GoHighLevel. */
export async function createContact(
  input: ContactInput,
  pushToGhl: boolean,
): Promise<{ id: string; sync: SyncResult }> {
  const userId = await currentUserId();
  const email = input.primary_email?.trim().toLowerCase() || null;

  const externalIds: Record<string, string> = {};
  const sync: SyncResult = { ghl: "skipped" };

  if (pushToGhl) {
    try {
      const { firstName, lastName } = splitName(input.display_name);
      const res = await callGhl("create_contact", {
        body: {
          firstName,
          lastName,
          email: email || undefined,
          phone: input.primary_phone || undefined,
          companyName: input.company || undefined,
          source: "Ozlon",
        },
      });
      const contact = (res?.contact ?? res) as { id?: string };
      if (contact?.id) externalIds.gohighlevel = contact.id;
      sync.ghl = "created";
    } catch (e) {
      sync.ghl = "failed";
      sync.message = e instanceof Error ? e.message : String(e);
    }
  }

  const { data, error } = await supabase
    .from("entities")
    .insert({
      user_id: userId,
      display_name: input.display_name.trim(),
      entity_type: input.entity_type || "person",
      primary_email: email,
      primary_phone: input.primary_phone?.trim() || null,
      company: input.company?.trim() || null,
      notes: input.notes?.trim() || null,
      starred: !!input.starred,
      source: externalIds.gohighlevel ? "gohighlevel" : "manual",
      external_ids: externalIds,
      importance_score: 0.5,
      interaction_count: 0,
      channel_counts: {},
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (email) {
    await supabase.from("entity_identities").insert({
      user_id: userId,
      entity_id: data.id,
      channel: "email",
      identifier: email,
      display_label: input.display_name.trim(),
      verified: true,
    });
  }

  return { id: data.id, sync };
}

/** Update a contact locally and mirror the change to GoHighLevel when linked. */
export async function updateContact(
  id: string,
  input: ContactInput,
  pushToGhl: boolean,
  externalIds: Record<string, string> = {},
): Promise<SyncResult> {
  const email = input.primary_email?.trim().toLowerCase() || null;
  const sync: SyncResult = { ghl: "skipped" };
  const ids = { ...externalIds };

  if (pushToGhl) {
    const { firstName, lastName } = splitName(input.display_name);
    const body = {
      firstName,
      lastName,
      email: email || undefined,
      phone: input.primary_phone || undefined,
      companyName: input.company || undefined,
    };
    try {
      if (ids.gohighlevel) {
        await callGhl("update_contact", { params: { contactId: ids.gohighlevel }, body });
        sync.ghl = "updated";
      } else {
        const res = await callGhl("create_contact", { body: { ...body, source: "Ozlon" } });
        const contact = (res?.contact ?? res) as { id?: string };
        if (contact?.id) ids.gohighlevel = contact.id;
        sync.ghl = "created";
      }
    } catch (e) {
      sync.ghl = "failed";
      sync.message = e instanceof Error ? e.message : String(e);
    }
  }

  const { error } = await supabase
    .from("entities")
    .update({
      display_name: input.display_name.trim(),
      primary_email: email,
      primary_phone: input.primary_phone?.trim() || null,
      company: input.company?.trim() || null,
      notes: input.notes?.trim() || null,
      starred: !!input.starred,
      entity_type: input.entity_type || "person",
      external_ids: ids,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);

  return sync;
}

/** Remove a contact from Ozlon. The record in the source app is left untouched. */
export async function deleteContact(id: string): Promise<void> {
  await supabase.from("entity_identities").delete().eq("entity_id", id);
  const { error } = await supabase.from("entities").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function toggleStar(id: string, starred: boolean): Promise<void> {
  const { error } = await supabase.from("entities").update({ starred }).eq("id", id);
  if (error) throw new Error(error.message);
}

interface GhlContact {
  id: string;
  firstName?: string;
  lastName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
}

/** Pull contacts from GoHighLevel into the People list. Matches on email, then on GHL id. */
export async function importFromGhl(limit = 100): Promise<{ added: number; updated: number }> {
  const userId = await currentUserId();
  const res = await callGhl("list_contacts", { params: { limit } });
  const contacts = ((res?.contacts as GhlContact[]) || []).filter(Boolean);

  const { data: existing } = await supabase
    .from("entities")
    .select("id, primary_email, external_ids")
    .eq("user_id", userId);

  const byEmail = new Map<string, string>();
  const byGhlId = new Map<string, string>();
  for (const e of existing || []) {
    if (e.primary_email) byEmail.set(e.primary_email.toLowerCase(), e.id);
    const gid = (e.external_ids as Record<string, string> | null)?.gohighlevel;
    if (gid) byGhlId.set(gid, e.id);
  }

  let added = 0;
  let updated = 0;

  for (const c of contacts) {
    const name =
      c.contactName?.trim() ||
      [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
      c.email ||
      "Unnamed contact";
    const email = c.email?.trim().toLowerCase() || null;
    const match = byGhlId.get(c.id) || (email ? byEmail.get(email) : undefined);

    if (match) {
      await supabase
        .from("entities")
        .update({
          display_name: name,
          primary_email: email,
          primary_phone: c.phone || null,
          company: c.companyName || null,
          external_ids: { gohighlevel: c.id },
          source: "gohighlevel",
        })
        .eq("id", match);
      updated++;
    } else {
      const { data: inserted } = await supabase
        .from("entities")
        .insert({
          user_id: userId,
          display_name: name,
          entity_type: "person",
          primary_email: email,
          primary_phone: c.phone || null,
          company: c.companyName || null,
          source: "gohighlevel",
          external_ids: { gohighlevel: c.id },
          importance_score: 0.45,
          interaction_count: 0,
          channel_counts: {},
        })
        .select("id")
        .single();
      if (inserted?.id && email) {
        await supabase.from("entity_identities").insert({
          user_id: userId,
          entity_id: inserted.id,
          channel: "email",
          identifier: email,
          display_label: name,
          verified: true,
        });
      }
      added++;
    }
  }

  return { added, updated };
}
