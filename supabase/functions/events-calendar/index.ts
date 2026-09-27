// Direct event <-> Google Calendar actions for the Events page.
// Actions: add | remove | resync_all
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, getAdminClient, getAuthedUserId } from "../_shared/google-token.ts";
import { addEventsToCalendar, removeEventsFromCalendar, type CalCall } from "../_shared/events-calendar.ts";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const userId = await getAuthedUserId(req);
    const authHeader = req.headers.get("Authorization") || "";
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const ids = Array.isArray(body.event_ids) ? body.event_ids.filter((x: unknown) => typeof x === "string").slice(0, 50) : [];
    if (!["add", "remove", "resync_all"].includes(action)) return json({ success: false, error: "action must be add, remove or resync_all" }, 400);
    if (action !== "resync_all" && ids.length === 0) return json({ success: false, error: "event_ids required" }, 400);

    const admin = getAdminClient();
    let q = admin.from("discovered_events").select("*").eq("user_id", userId);
    q = action === "resync_all" ? q.not("calendar_event_id", "is", null) : q.in("id", ids);
    const { data: rows, error } = await q;
    if (error) return json({ success: false, error: error.message }, 500);

    const cal: CalCall = async (a, params) => {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/google-calendar`, {
        method: "POST",
        headers: { Authorization: authHeader, apikey: Deno.env.get("SUPABASE_ANON_KEY") || "", "Content-Type": "application/json" },
        body: JSON.stringify({ action: a, params }),
      });
      const t = await r.text();
      let d: Record<string, unknown> = {};
      try { d = t ? JSON.parse(t) : {}; } catch { d = { error: t }; }
      if (!r.ok || d.success === false) throw new Error(String(d.error || `calendar ${a} failed (${r.status})`));
      return d;
    };

    const lines = action === "remove"
      ? await removeEventsFromCalendar(admin, userId, cal, rows || [])
      : await addEventsToCalendar(admin, userId, cal, rows || [], { force: true });
    return json({ success: lines.every((l) => l.status !== "failed"), results: lines });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return json({ success: false, error: msg }, /auth|jwt|token/i.test(msg) ? 401 : 500);
  }
});
