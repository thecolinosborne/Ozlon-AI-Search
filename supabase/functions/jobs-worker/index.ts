// Background jobs worker. Claims up to N queued jobs and runs them.
// Triggered by pg_cron every minute. Idempotent: uses a status transition
// (queued -> running) with row-level lock to avoid double-processing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_JOBS_PER_TICK = 5;
const JOB_TIMEOUT_MS = 120_000;

interface Job {
  id: string;
  user_id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  conversation_id: string | null;
  assistant_message_id: string | null;
}

async function runJob(admin: ReturnType<typeof createClient>, job: Job): Promise<{ result?: unknown; error?: string }> {
  // Dispatch by kind. Add new kinds here.
  switch (job.kind) {
    case "echo":
      return { result: { echoed: job.payload, at: new Date().toISOString() } };

    case "deep_research":
    case "scrape_events":
    case "youtube_channel_analysis":
    case "seo_audit": {
      // Delegate to existing edge function with the user's id baked into payload.
      const fnMap: Record<string, string> = {
        deep_research: "deep-research",
        scrape_events: "scrape-events",
        youtube_channel_analysis: "youtube-analyze",
        seo_audit: "seo-audit",
      };
      const fn = fnMap[job.kind];
      if (!fn) return { error: `no edge fn mapped for ${job.kind}` };
      const r = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ ...job.payload, __user_id: job.user_id }),
      });
      const text = await r.text();
      if (!r.ok) return { error: `${fn} ${r.status}: ${text.slice(0, 500)}` };
      try { return { result: JSON.parse(text) }; } catch { return { result: { raw: text } }; }
    }

    default:
      return { error: `unknown job kind: ${job.kind}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Claim queued jobs atomically (set status=running) via a SQL update with RETURNING.
  const { data: claimed, error: claimErr } = await admin.rpc("claim_background_jobs", {
    _limit: MAX_JOBS_PER_TICK,
  }).select?.() ?? { data: null, error: null };

  // Fallback when RPC doesn't exist: do a simple update inline.
  let jobs: Job[] = [];
  if (claimErr || !claimed) {
    const { data: queued } = await admin
      .from("background_jobs")
      .select("id,user_id,kind,payload,attempts,max_attempts,conversation_id,assistant_message_id")
      .eq("status", "queued")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(MAX_JOBS_PER_TICK);
    if (queued && queued.length > 0) {
      const ids = queued.map((j) => j.id);
      const { data: locked } = await admin
        .from("background_jobs")
        .update({ status: "running", started_at: new Date().toISOString(), attempts: queued[0].attempts + 1 })
        .in("id", ids)
        .eq("status", "queued")
        .select("id,user_id,kind,payload,attempts,max_attempts,conversation_id,assistant_message_id");
      jobs = (locked as Job[]) || [];
    }
  } else {
    jobs = claimed as Job[];
  }

  const summary: Array<{ id: string; ok: boolean; err?: string }> = [];

  await Promise.all(
    jobs.map(async (job) => {
      try {
        const { result, error } = await Promise.race([
          runJob(admin, job),
          new Promise<{ error: string }>((resolve) =>
            setTimeout(() => resolve({ error: `timeout after ${JOB_TIMEOUT_MS}ms` }), JOB_TIMEOUT_MS),
          ),
        ]);
        if (error) {
          const final = job.attempts >= job.max_attempts;
          await admin
            .from("background_jobs")
            .update({
              status: final ? "failed" : "queued",
              error,
              completed_at: final ? new Date().toISOString() : null,
              scheduled_for: final ? undefined : new Date(Date.now() + 30_000 * job.attempts).toISOString(),
            })
            .eq("id", job.id);
          summary.push({ id: job.id, ok: false, err: error });
        } else {
          await admin
            .from("background_jobs")
            .update({ status: "done", result: result as never, progress: 100, completed_at: new Date().toISOString() })
            .eq("id", job.id);
          summary.push({ id: job.id, ok: true });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await admin.from("background_jobs").update({ status: "failed", error: msg, completed_at: new Date().toISOString() }).eq("id", job.id);
        summary.push({ id: job.id, ok: false, err: msg });
      }
    }),
  );

  return new Response(JSON.stringify({ processed: jobs.length, summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
