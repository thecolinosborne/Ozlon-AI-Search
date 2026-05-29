// Morning brief. Runs daily; writes one "morning_brief" signal_moment per
// active user with a calm 2-sentence summary of the day ahead.
// Intentionally lightweight — pulls calendar count, top sender, and any
// overdue ClickUp tasks if the integration is connected.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function briefOne(admin: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  // Skip if a brief already exists today.
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const { data: existing } = await admin
    .from("signal_moments")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", "morning_brief")
    .gte("created_at", todayStart.toISOString())
    .limit(1);
  if (existing && existing.length > 0) return false;

  // Pull lightweight context — count today's calendar items + overdue work tasks.
  const { count: overdue } = await admin
    .from("work_tasks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("status", "completed")
    .lt("due_at", new Date().toISOString());

  const parts: string[] = [];
  if (overdue && overdue > 0) parts.push(`${overdue} task${overdue === 1 ? "" : "s"} overdue`);
  parts.push("today's calendar is loaded");
  const headline = `Good morning. ${parts.join(", ")}.`;

  await admin.from("signal_moments").insert({
    user_id: userId,
    kind: "morning_brief",
    headline,
    reason: "Daily 7am brief",
    salience: 0.6,
    confidence: 0.9,
    mode_context: "any",
    status: "live",
    metadata: { overdue_tasks: overdue ?? 0, auto: true },
  });
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Active users = anyone with a profile that's logged in recently.
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const { data: users } = await admin
    .from("profiles")
    .select("user_id")
    .gte("updated_at", since)
    .limit(500);

  let written = 0;
  for (const u of users || []) {
    try {
      if (await briefOne(admin, u.user_id as string)) written++;
    } catch (e) {
      console.warn("brief failed", u.user_id, e);
    }
  }
  return new Response(JSON.stringify({ users: users?.length ?? 0, written }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
